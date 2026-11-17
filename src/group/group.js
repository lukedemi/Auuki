//
// Group rides in the app: joining, riding in sync, and sharing numbers.
// doc/group-ride.md.
//
// A ride is opened from its link, /?g=<id>#k=<joinKey> (the host's own link
// adds &h=<hostKey>). Once joined:
//
// - The workout's position comes from the clock, not from counting: on every
//   tick (ticker.js, 50 ms) the position is worked out from the frozen
//   schedule and server time (schedule.js, clock.js), and when the second
//   changes the watch is told the interval, step and time left, through the
//   same dispatches watch.js uses itself. watch.js, in group mode, only
//   records. So a reload, a late join, a throttled tab or a pause all land
//   on the second everyone else is on.
// - Warmup until the start time, then the workout, then cooldown: the app
//   with no workout running, ERG target free, for as long as anyone likes.
// - Every second my numbers go to the server and everyone's come back
//   (riders.js). The server is not needed to stay in sync: the schedule and
//   the clock offset are kept in localStorage, so with the server gone the
//   workout carries on and only other people's numbers go grey.
//
// Views talk to this through xf: ui:group:* in; group:* out.
//

import { xf } from '../functions.js';
import { timeline, positionAt, positionKey } from './schedule.js';
import { Clock } from './clock.js';
import { Connection } from './connection.js';
import { Riders, Summary } from './riders.js';

export const STORE_PREFIX = 'group:';
const NAME_KEY = 'group:name';
const PING_EVERY_MS = 30000;

// ?g=<id>#k=<key>&h=<hostKey>
export function readLink(loc) {
    const id = new URLSearchParams(loc.search ?? '').get('g');
    if(!id || !/^[a-z2-9]{10}$/.test(id)) return null;
    const hash = new URLSearchParams((loc.hash ?? '').replace(/^#/, ''));
    return {id, key: hash.get('k') || null, hostKey: hash.get('h') || null};
}

export function rideLink(origin, id, key, hostKey) {
    return `${origin}/?g=${id}#k=${key}${hostKey ? `&h=${hostKey}` : ''}`;
}

// a page timer; start.js hands in the Worker one (ticker.js)
function pageTicker(onTick) {
    let t = null;
    return {start: () => { t ??= setInterval(onTick, 50); }, stop: () => { clearInterval(t); t = null; }};
}

export function GroupController(deps = {}) {
    const fetchImpl = deps.fetch ?? ((...a) => globalThis.fetch(...a));
    const storage = deps.storage ?? globalThis.localStorage;
    const loc = deps.location ?? globalThis.location;
    const hist = deps.history ?? globalThis.history;
    const clock = deps.clock ?? Clock();
    const riders = deps.riders ?? Riders();
    const makeTicker = deps.makeTicker ?? pageTicker;
    const WebSocketImpl = deps.WebSocketImpl;
    const startMedia = deps.startMedia ?? (async (...a) => (await import('./media.js')).startMedia(...a));

    let link = null;           // {id, key, hostKey}
    let saved = null;          // what's kept for this ride in localStorage
    let ride = null;           // {id, title, startAt, lobbyS, durationS, workout}
    let sched = null;
    let stage = 'idle';        // idle | join | riding | ended
    let conn = null;
    let ticker = null;
    let pingTimer = null;
    let lastKey = null;
    let phase = null;
    let cur = {iv: -1, st: -1};
    let summary = null;
    let summarySent = false;
    let media = null;
    const mine = [];           // my last 10 min, [[t, w, hr, cad, tgt]], for hello
    const db = {power1s: 0, heartRate: 0, cadence: 0, powerTarget: 0, ftp: 0, watchStatus: 'stopped', workoutStatus: 'stopped'};

    // ---- storage ----
    const storeKey = () => `${STORE_PREFIX}${link.id}`;
    function load() {
        try { return JSON.parse(storage.getItem(storeKey()) ?? 'null'); } catch(_) { return null; }
    }
    function save() {
        try { storage.setItem(storeKey(), JSON.stringify(saved)); } catch(_) {}
    }

    function setStage(s, detail = {}) {
        stage = s;
        xf.dispatch('group:stage', {stage: s, ...detail});
    }

    // ---- start: the page was opened from a ride's link ----

    async function start() {
        link = readLink(loc);
        if(!link) return;
        saved = load() ?? {};
        if(link.key) saved.key = link.key;
        if(link.hostKey) saved.hostKey = link.hostKey;
        save();
        // keep the join key in the address bar (a reload needs it), not the host key
        if(link.hostKey && hist?.replaceState) hist.replaceState(null, '', `${loc.pathname}?g=${link.id}#k=${saved.key}`);
        if(!saved.key) return setStage('ended', {error: 'This link is missing its key. Ask for the link again.'});

        let fresh = null;
        try {
            const res = await fetchImpl(`/api/group/${link.id}`, {headers: {'X-Join-Key': saved.key}});
            const body = await res.json();
            if(!res.ok) {
                if(!saved.ride) return setStage('ended', {error: body.error ?? 'No such ride.'});
            } else {
                fresh = body;
                saved.ride = body;
                save();
            }
        } catch(_) {
            // the server's unreachable: what was kept from last time will do
        }
        if(!saved.ride) return setStage('ended', {error: 'Could not reach the group ride. Check the connection and reload.'});
        ride = saved.ride;
        sched = {startAt: ride.startAt, lobbyS: ride.lobbyS, timeline: timeline(ride.workout)};
        if(fresh && !clock.synced()) {
            // a first guess at server time until the socket measures it
            clock.onPong({t0: clock.local(), server: fresh.server}, clock.local());
        }
        if(Number.isFinite(saved.offset) && !clock.synced()) clock.onPong({t0: 0, server: saved.offset}, 0);
        xf.dispatch('group:ride', {...ride, host: !!saved.hostKey, name: saved.name ?? storage.getItem(NAME_KEY) ?? ''});

        if(ride.closed) return setStage('ended', {error: 'This ride is over.'});
        // back after a reload, mid-ride: straight in
        if(saved.token && !saved.left) return join({name: saved.name, shareHr: saved.shareHr, auto: true});
        setStage('join');
    }

    // ---- joining ----

    async function join({name, shareHr = true, auto = false} = {}) {
        if(!ride) return;
        name = String(name ?? '').trim().slice(0, 32);
        try { storage.setItem(NAME_KEY, name); } catch(_) {}
        Object.assign(saved, {name, shareHr: shareHr !== false, left: false});
        save();
        try {
            const res = await fetchImpl(`/api/group/${link.id}/join`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({key: saved.key, hostKey: saved.hostKey, name, token: saved.token}),
            });
            const body = await res.json();
            if(res.status === 425) return setStage('join', {error: null, opensAt: body.opensAt});
            if(res.status === 410) return setStage('ended', {error: 'This ride is over.'});
            if(!res.ok) {
                if(auto && saved.token) return ridingStart();     // keep going on what we have
                return setStage('join', {error: body.error ?? 'Could not join.'});
            }
            Object.assign(saved, {token: body.token, riderId: body.riderId, host: body.host, name: body.name});
            save();
        } catch(_) {
            if(!saved.token) return setStage('join', {error: 'Could not reach the group ride. Try again.'});
        }
        ridingStart();
    }

    function ridingStart() {
        riders.setMe(saved.riderId);
        xf.dispatch('group:mode', true);
        xf.dispatch('workout', ride.workout);
        if(db.workoutStatus === 'started' && positionAt(sched, clock.now()).phase !== 'workout') {
            xf.dispatch('workout:stopped');       // a solo workout left over from before
        }
        setStage('riding', {host: !!saved.host, riderId: saved.riderId});

        conn = Connection({
            url: () => `${loc.protocol === 'http:' ? 'ws' : 'wss'}://${loc.host}/api/group/${link.id}/ws?token=${encodeURIComponent(saved.token)}`,
            WebSocketImpl,
            onOpen,
            onMessage,
            onState: (s, detail) => {
                xf.dispatch('group:conn', s);
                if(s === 'ended' && detail?.code >= 4000) onEnded(detail.code);
            },
        });
        conn.connect();
        pingTimer = setInterval(() => conn?.send(clock.ping()), PING_EVERY_MS);
        ticker = makeTicker(onTick);
        ticker.start();
        lastKey = null;
        phase = null;
        cur = {iv: -1, st: -1};
        onTick();

        startMedia({rideId: link.id, token: saved.token, riderId: saved.riderId})
            .then((m) => { media = m; xf.dispatch('group:media', m ? m.state() : {available: false}); })
            .catch((err) => { console.warn('group: video', err); xf.dispatch('group:media', {available: false, error: String(err?.message ?? err)}); });
    }

    function onOpen() {
        clock.reset();
        conn.send({type: 'hello', history: mine.slice(-600)});
        // five pings to measure the clock; the fastest wins (clock.js)
        for(let i = 0; i < 5; i++) setTimeout(() => conn?.send(clock.ping()), i * 200);
    }

    function onMessage(m) {
        switch(m.type) {
        case 'pong':
            clock.onPong(m);
            saved.offset = clock.offset();
            save();
            break;
        case 'welcome':
            riders.setRoster(m.roster);
            riders.setHistory(m.history);
            xf.dispatch('group:riders', riders);
            break;
        case 'roster':
            riders.setRoster(m.roster);
            xf.dispatch('group:riders', riders);
            break;
        case 'tick':
            riders.onTick(m);
            xf.dispatch('group:riders', riders);
            break;
        case 'react':
            xf.dispatch('group:react', {from: m.from, emoji: m.emoji});
            break;
        case 'closed':
            xf.dispatch('group:closed', m.reason);
            break;
        }
    }

    // ---- the clock, every 50 ms; the work, once a second ----

    function onTick() {
        if(!sched) return;
        const pos = positionAt(sched, clock.now());
        const key = positionKey(pos);
        if(key === lastKey) return;
        lastKey = key;
        onSecond(pos);
    }

    function onSecond(pos) {
        const from = phase;
        if(pos.phase !== phase) {
            phase = pos.phase;
            enterPhase(pos.phase, from);
        }
        if(pos.phase === 'workout') applyWorkout(pos, from !== 'workout', from === 'warmup');
        xf.dispatch('group:position', pos);
        sendSample(pos);
    }

    function enterPhase(p, from) {
        if(p === 'workout') {
            if(db.watchStatus === 'stopped') xf.dispatch('ui:watchStart');
            summary = Summary();
            summarySent = false;
            xf.dispatch('workout:started');
        }
        if(p === 'cooldown' && (from === 'workout' || db.workoutStatus === 'started')) {
            xf.dispatch('workout:done');
            sendSummary();
        }
    }

    // the watch's own dispatches (watch.js dispatchInterval, dispatchStep),
    // from the schedule instead of a count
    function applyWorkout(pos, force, fromWarmup) {
        const ivChanged = force || pos.intervalIndex !== cur.iv;
        const stChanged = ivChanged || pos.stepIndex !== cur.st;
        if(ivChanged) {
            xf.dispatch('watch:intervalDuration', pos.intervalDuration);
            xf.dispatch('watch:lapDuration', pos.intervalDuration);
            xf.dispatch('watch:intervalIndex', pos.intervalIndex);
            // a lap at each new interval, and at the start; not when a
            // reload lands mid-interval
            if((!force || fromWarmup) && db.watchStatus !== 'stopped') xf.dispatch('watch:lap');
        }
        if(stChanged) {
            xf.dispatch('watch:stepDuration', pos.stepDuration);
            xf.dispatch('watch:stepIndex', pos.stepIndex);
            xf.dispatch('watch:step');
        }
        xf.dispatch('watch:lapTime', pos.intervalLeft);
        xf.dispatch('watch:stepTime', pos.stepLeft);
        if(pos.intervalLeft === 4 && !force) xf.dispatch('watch:beep', 'interval');
        cur = {iv: pos.intervalIndex, st: pos.stepIndex};
        summary?.add(db.power1s, db.heartRate);
    }

    function sendSample(pos) {
        const w = Math.round(db.power1s || 0);
        const sample = {
            w,
            hr: saved.shareHr !== false && db.heartRate > 0 ? Math.round(db.heartRate) : null,
            cad: db.cadence > 0 ? Math.round(db.cadence) : null,
            tgt: db.powerTarget > 0 ? Math.round(db.powerTarget) : null,
            ftp: db.ftp > 0 ? Math.round(db.ftp) : null,
            st8: db.watchStatus === 'paused' ? 'p' : w < 20 ? 'c' : 'r',
        };
        const t = Math.round(clock.now() / 1000);
        mine.push([t, sample.w, sample.hr, sample.cad, sample.tgt]);
        if(mine.length > 600) mine.shift();
        riders.onMine(sample, t);
        conn?.send({type: 's', t: Math.round(clock.now()), ...sample});
        xf.dispatch('group:riders', riders);
    }

    function sendSummary() {
        if(!summary || summarySent) return;
        const s = summary.result();
        if(!s.seconds) return;
        if(conn?.send({type: 'summary', ...s})) summarySent = true;
    }

    // ---- leaving, or being told to ----

    function stopRiding() {
        ticker?.stop();
        ticker = null;
        clearInterval(pingTimer);
        pingTimer = null;
        media?.leave();
        media = null;
        xf.dispatch('group:mode', false);
    }

    function leave() {
        if(stage !== 'riding') return;
        if(phase === 'cooldown') sendSummary();
        conn?.close();
        conn = null;
        stopRiding();
        saved.left = true;
        save();
        setStage('ended', {error: null, left: true});
    }

    function onEnded(code) {
        conn = null;
        stopRiding();
        saved.left = true;
        save();
        const why = code === 4000 ? 'The ride is over.'
            : code === 4003 ? 'The host removed you from the ride.'
            : code === 4009 ? 'This ride is open in another tab or device.'
            : 'The ride ended.';
        setStage('ended', {error: why, code});
    }

    // ---- wiring ----

    function wire() {
        xf.sub('db:power1s',       (v) => { db.power1s = v; });
        xf.sub('db:heartRate',     (v) => { db.heartRate = v; });
        xf.sub('db:cadence',       (v) => { db.cadence = v; });
        xf.sub('db:powerTarget',   (v) => { db.powerTarget = v; });
        xf.sub('db:ftp',           (v) => { db.ftp = v; });
        xf.sub('db:watchStatus',   (v) => { db.watchStatus = v; });
        xf.sub('db:workoutStatus', (v) => { db.workoutStatus = v; });
        xf.sub('ui:group:join',    (v) => join(v));
        xf.sub('ui:group:leave',   () => {
            // ending the ride saves it (watch.js stop → the end screen), and
            // the watch:stopped below leaves
            if(db.watchStatus !== 'stopped') xf.dispatch('ui:watchEnd'); else leave();
        });
        xf.sub('watch:stopped',    () => leave());
        xf.sub('ui:group:kick',    (id) => conn?.send({type: 'kick', id}));
        xf.sub('ui:group:close',   () => conn?.send({type: 'close'}));
        xf.sub('ui:group:react',   (emoji) => conn?.send({type: 'react', emoji}));
        xf.sub('ui:group:mic',     (on) => media?.setMic(on));
        xf.sub('ui:group:cam',     (on) => media?.setCam(on));
    }

    return {
        start, join, leave, wire, onTick, onMessage,
        riders, clock,
        stage: () => stage,
        phase: () => phase,
        ride: () => ride,
        media: () => media,
        // for the chaos test and the console
        drop: () => conn?.drop(),
        _db: db,
    };
}
