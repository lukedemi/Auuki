//
// GroupRide: the Durable Object behind one group ride.
//
// Deliberately dumb. It holds the schedule and the roster (in storage), the
// latest sample from each rider and their last 10 minutes (in memory, and
// rebuilt from the riders' own copies if the object restarts), and sends
// everyone one tick a second with everyone's numbers. It decides nothing
// about timing: every rider works the workout out from the schedule and the
// clock themselves (src/group/schedule.js), so this object can restart
// mid-interval without anyone's workout noticing. doc/group-ride.md.
//
// A plain class rather than `extends DurableObject`, so the tests can build
// one with a fake ctx.
//

import { positionAt, LOBBY_S } from '../../../src/group/schedule.js';

export const PROTOCOL = 1;
export const HISTORY = 600;            // samples per rider, 10 min at 1 Hz
export const TICK_MS = 900;            // at most one tick a ~second
export const EMPTY_CLOSE_MS = 10 * 60 * 1000;
export const HARD_CLOSE_MS = 12 * 3600 * 1000;
export const HOUSEKEEP_MS = 5 * 60 * 1000;

export const CLOSE = {
    closed:   4000,    // the ride is over
    removed:  4003,    // the host removed you
    replaced: 4009,    // you connected again from somewhere else
};

const REACTIONS = new Set(['👍', '🔥', '💪', '😅', '👏']);

const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);

// what a rider's sample may say, cleaned
export function cleanSample(m) {
    return {
        w:   num(m.w, 0, 3000) ?? 0,
        hr:  num(m.hr, 0, 260),
        cad: num(m.cad, 0, 250),
        tgt: num(m.tgt, 0, 3000),
        ftp: num(m.ftp, 0, 1000),
        st8: ['r', 'p', 'c'].includes(m.st8) ? m.st8 : 'r',
    };
}

// [t s, w, hr, cad, tgt] rows from a client's own history
function cleanHistory(rows) {
    if(!Array.isArray(rows)) return [];
    return rows.slice(-HISTORY).filter(Array.isArray).map((r) => [
        num(r[0], 0, 1e11) ?? 0, num(r[1], 0, 3000) ?? 0, num(r[2], 0, 260), num(r[3], 0, 250), num(r[4], 0, 3000),
    ]);
}

export class GroupRide {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.latest = new Map();     // riderId → {…sample, at}
        this.history = new Map();    // riderId → [[t, w, hr, cad, tgt]]
        this.lastTick = 0;
        this.ride = null;            // the schedule, cached from storage
        this.roster = null;          // riderId → {name, host, joined, left, kicked}
        this.now = () => Date.now();
        this.makePair = () => { const p = new WebSocketPair(); return [p[0], p[1]]; };
        this.upgraded = (client) => new Response(null, {status: 101, webSocket: client});
    }

    async load() {
        if(this.ride === null) {
            this.ride = (await this.ctx.storage.get('ride')) ?? null;
            this.roster = (await this.ctx.storage.get('roster')) ?? {};
        }
        return this.ride;
    }
    async saveRoster() {
        await this.ctx.storage.put('roster', this.roster);
    }
    schedule() {
        return {startAt: this.ride.startAt, lobbyS: this.ride.lobbyS, timeline: this.ride.timeline};
    }

    // ---- HTTP (only the Worker in index.js can reach this) ----

    async fetch(request) {
        const url = new URL(request.url);
        if(url.pathname === '/init' && request.method === 'POST') return this.init(await request.json());
        if(url.pathname === '/ws') return this.accept(request);
        if(url.pathname === '/state') {
            await this.load();
            return Response.json({ride: this.ride && {...this.ride, timeline: undefined}, roster: this.roster, connected: this.ctx.getWebSockets().length});
        }
        return new Response('not found', {status: 404});
    }

    async init(ride) {
        await this.load();
        if(this.ride) return new Response('exists', {status: 409});
        this.ride = {
            id: ride.id, title: ride.title, workout: ride.workout, timeline: ride.timeline,
            startAt: ride.startAt, lobbyS: ride.lobbyS ?? LOBBY_S, durationS: ride.timeline.durationS,
            closed: null,
        };
        this.roster = {};
        await this.ctx.storage.put('ride', this.ride);
        await this.saveRoster();
        await this.armAlarm();
        return new Response('ok');
    }

    async accept(request) {
        if(request.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', {status: 426});
        await this.load();
        const who = JSON.parse(request.headers.get('X-Rider') ?? 'null');
        if(!this.ride || !who?.p) return new Response('not found', {status: 404});

        const [client, server] = this.makePair();
        this.ctx.acceptWebSocket(server, [who.p]);
        server.serializeAttachment({id: who.p, name: who.n, host: !!who.h});

        // over, or removed: say so, so the client stops retrying
        const prior = this.roster[who.p];
        if(this.ride.closed || prior?.kicked) {
            server.close(this.ride.closed ? CLOSE.closed : CLOSE.removed, this.ride.closed ? 'ride closed' : 'removed');
            return this.upgraded(client);
        }

        // one connection per rider: a reload's new socket replaces the old
        for(const old of this.ctx.getWebSockets(who.p)) {
            if(old !== server) { try { old.close(CLOSE.replaced, 'replaced'); } catch(_) {} }
        }

        this.roster[who.p] = {
            name: who.n, host: !!who.h,
            joined: prior?.joined ?? this.now(), left: null, kicked: false,
        };
        await this.saveRoster();
        this.broadcastRoster();
        return this.upgraded(client);
    }

    // ---- WebSocket events (hibernation API) ----

    async webSocketMessage(ws, data) {
        await this.load();
        let msg;
        try { msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch(_) { return; }
        const me = ws.deserializeAttachment() ?? {};
        if(!me.id || !this.ride) return;
        const now = this.now();

        switch(msg?.type) {
        case 'ping':
            this.send(ws, {type: 'pong', t0: msg.t0, server: now});
            break;
        case 'hello': {
            // the rider's own last minutes rebuild what a restart lost
            const theirs = cleanHistory(msg.history);
            if(theirs.length > (this.history.get(me.id)?.length ?? 0)) this.history.set(me.id, theirs);
            this.send(ws, this.welcome(me, now));
            break;
        }
        case 's': {
            const sample = {...cleanSample(msg), at: now};
            this.latest.set(me.id, sample);
            const rows = this.history.get(me.id) ?? [];
            rows.push([Math.round(now / 1000), sample.w, sample.hr, sample.cad, sample.tgt]);
            if(rows.length > HISTORY) rows.splice(0, rows.length - HISTORY);
            this.history.set(me.id, rows);
            if(now - this.lastTick >= TICK_MS) this.tick(now);
            break;
        }
        case 'summary':
            await this.ctx.storage.put(`summary:${me.id}`, {
                avg_w: num(msg.avg_w, 0, 3000), np_w: num(msg.np_w, 0, 3000),
                avg_hr: num(msg.avg_hr, 0, 260), kj: num(msg.kj, 0, 100000),
            });
            break;
        case 'react':
            if(REACTIONS.has(msg.emoji)) this.broadcast({type: 'react', from: me.id, emoji: msg.emoji});
            break;
        case 'kick':
            if(me.host && msg.id && msg.id !== me.id && this.roster[msg.id]) {
                this.roster[msg.id].kicked = true;
                this.roster[msg.id].left = now;
                await this.saveRoster();
                for(const s of this.ctx.getWebSockets(msg.id)) { try { s.close(CLOSE.removed, 'removed'); } catch(_) {} }
                this.latest.delete(msg.id);
                this.broadcastRoster();
            }
            break;
        case 'close':
            if(me.host) await this.finish('closed by the host');
            break;
        }
    }

    async webSocketClose(ws) {
        await this.left(ws);
    }
    async webSocketError(ws) {
        await this.left(ws);
    }
    async left(ws) {
        await this.load();
        const me = ws.deserializeAttachment() ?? {};
        if(!me.id || !this.roster?.[me.id]) return;
        const still = this.ctx.getWebSockets(me.id).some((s) => s !== ws && s.readyState === 1);
        if(still) return;
        this.roster[me.id].left = this.now();
        this.latest.delete(me.id);
        await this.saveRoster();
        this.broadcastRoster();
    }

    // ---- what goes out ----

    rosterView() {
        const out = {};
        for(const [id, r] of Object.entries(this.roster ?? {})) {
            if(r.kicked) continue;
            out[id] = {name: r.name, host: r.host, connected: r.left === null, joined: r.joined};
        }
        return out;
    }

    welcome(me, now) {
        const {timeline, closed, ...ride} = this.ride;
        return {
            type: 'welcome', v: PROTOCOL, you: me.id, host: !!me.host, server: now,
            ride, phase: positionAt(this.schedule(), now).phase,
            roster: this.rosterView(),
            history: Object.fromEntries(this.history),
        };
    }

    tick(now) {
        this.lastTick = now;
        const riders = {};
        for(const [id, s] of this.latest) {
            riders[id] = {w: s.w, hr: s.hr, cad: s.cad, tgt: s.tgt, ftp: s.ftp, st8: s.st8, age: Math.round((now - s.at) / 100) / 10};
        }
        this.broadcast({type: 'tick', server: now, phase: positionAt(this.schedule(), now).phase, riders});
    }

    broadcastRoster() {
        this.broadcast({type: 'roster', roster: this.rosterView()});
    }

    send(ws, msg) {
        try { ws.send(JSON.stringify({v: PROTOCOL, ...msg})); } catch(_) {}
    }
    broadcast(msg) {
        const text = JSON.stringify({v: PROTOCOL, ...msg});
        for(const ws of this.ctx.getWebSockets()) {
            try { ws.send(text); } catch(_) {}
        }
    }

    // ---- alarms: phase announcements and closing up ----
    // Riders don't wait for these (they compute phases themselves); they
    // confirm the change, and clear the object away once everyone has left.

    async armAlarm() {
        const now = this.now();
        const {startAt, lobbyS, durationS} = this.ride;
        const marks = [startAt - lobbyS * 1000, startAt, startAt + durationS * 1000];
        const next = marks.find((m) => m > now) ?? now + HOUSEKEEP_MS;
        await this.ctx.storage.setAlarm(next);
    }

    async alarm() {
        await this.load();
        if(!this.ride || this.ride.closed) return;
        const now = this.now();
        this.broadcast({type: 'phase', phase: positionAt(this.schedule(), now).phase, server: now});

        const end = this.ride.startAt + this.ride.durationS * 1000;
        if(now >= end) {
            const open = this.ctx.getWebSockets().length;
            let emptySince = (await this.ctx.storage.get('emptySince')) ?? null;
            if(open) emptySince = null; else emptySince ??= now;
            await this.ctx.storage.put('emptySince', emptySince);
            if((emptySince !== null && now - emptySince >= EMPTY_CLOSE_MS) || now - end >= HARD_CLOSE_MS) {
                await this.finish(open ? 'the ride ran out of time' : 'everyone left');
                return;
            }
        }
        await this.armAlarm();
    }

    // the ride is over: tell everyone, write the record, stop
    async finish(reason) {
        const now = this.now();
        this.ride.closed = now;
        await this.ctx.storage.put('ride', this.ride);
        await this.ctx.storage.deleteAlarm();
        this.broadcast({type: 'closed', reason});
        for(const ws of this.ctx.getWebSockets()) { try { ws.close(CLOSE.closed, 'ride closed'); } catch(_) {} }

        const db = this.env?.DB;
        if(!db) return;
        const stmts = [db.prepare('UPDATE group_rides SET closed = ?1 WHERE id = ?2').bind(now, this.ride.id)];
        for(const [id, r] of Object.entries(this.roster ?? {})) {
            const s = (await this.ctx.storage.get(`summary:${id}`)) ?? {};
            stmts.push(db.prepare(
                'UPDATE group_riders SET left = ?1, avg_w = ?2, np_w = ?3, avg_hr = ?4, kj = ?5 WHERE ride_id = ?6 AND rider_id = ?7'
            ).bind(r.left ?? now, s.avg_w ?? null, s.np_w ?? null, s.avg_hr ?? null, s.kj ?? null, this.ride.id, id));
        }
        try { await db.batch(stmts); } catch(err) { console.error('group: D1 write failed', err); }
    }
}
