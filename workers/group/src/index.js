//
// auuki-group: the group-ride API and its Durable Object.
//
// The Pages site forwards /api/group/* and /api/host/group to this Worker
// over a service binding (functions/api/group/[[path]].js), so the browser
// only ever talks to auuki.d3-mi.com. doc/group-ride.md.
//
//   POST /api/host/group           create a ride (behind Cloudflare Access)
//   GET  /api/group/:id            the ride, for the join page (X-Join-Key)
//   POST /api/group/:id/join       → {riderId, token, host}
//   GET  /api/group/:id/ws?token=  the ride's WebSocket, handed to the DO
//   POST /api/group/:id/media      → a RealtimeKit auth token for this rider
//
// Secrets: TOKEN_SECRET; RTK_ACCOUNT_ID, RTK_APP_ID, RTK_API_TOKEN for video
// (without them the ride runs with no video). Vars: RTK_PRESET.
//

import { GroupRide } from './ride.js';
import { timeline, LOBBY_S } from '../../../src/group/schedule.js';
import { sign, verify, sha256, randomKey, randomId, same } from './token.js';

export { GroupRide };

const MAX_WORKOUT_BYTES = 256 * 1024;
const MAX_DURATION_S = 6 * 3600;
const TOKEN_GRACE_MS = 12 * 3600 * 1000;
const ID = /^[a-z2-9]{10}$/;

const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
const fail = (status, error, extra = {}) => json({error, ...extra}, status);

function cleanName(name, fallback = '') {
    const n = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32);
    return n || fallback;
}

async function readJson(request, limit = MAX_WORKOUT_BYTES + 4096) {
    const text = await request.text();
    if(text.length > limit) throw new Error('too large');
    return JSON.parse(text || '{}');
}

async function getRide(env, id) {
    if(!ID.test(id)) return null;
    return env.DB.prepare('SELECT * FROM group_rides WHERE id = ?1').bind(id).first();
}

async function keyOk(ride, key) {
    return !!ride && typeof key === 'string' && same(await sha256(key), ride.join_hash);
}

function publicRide(ride) {
    return {
        id: ride.id, title: ride.title, startAt: ride.start_at, durationS: ride.duration_s,
        lobbyS: LOBBY_S, workout: JSON.parse(ride.workout), closed: ride.closed,
    };
}

function stub(env, id) {
    return env.GROUP.get(env.GROUP.idFromName(id));
}

// ---- create ----

async function create(request, env) {
    const email = request.headers.get('Cf-Access-Authenticated-User-Email');
    if(!email && env.DEV !== '1') return fail(403, 'creating a ride needs a household login');

    let body;
    try { body = await readJson(request); } catch(_) { return fail(400, 'bad request body'); }
    const workout = body.workout;
    let tl;
    try { tl = timeline(workout); } catch(err) { return fail(400, `this workout can't be ridden as a group: ${err.message}`); }
    if(tl.durationS > MAX_DURATION_S) return fail(400, 'the workout is longer than 6 hours');
    const now = Date.now();
    const startAt = Math.round(Number(body.startAt));
    if(!Number.isFinite(startAt) || startAt < now - 5 * 60 * 1000 || startAt > now + 60 * 86400 * 1000) {
        return fail(400, 'the start time must be between now and 60 days from now');
    }
    const title = cleanName(body.title, workout?.meta?.name ?? 'Group ride').slice(0, 80);
    // durations filled in as the app's own parser has them (the workout
    // graph sizes its blocks by them)
    const intervals = workout.intervals.map((iv, i) => ({
        ...iv, duration: tl.intervals[i].dur,
        steps: iv.steps.map((st) => ({...st, duration: Math.round(st.duration)})),
    }));
    const frozen = JSON.stringify({
        meta: {name: workout?.meta?.name ?? title, category: workout?.meta?.category ?? '', description: workout?.meta?.description ?? '', duration: tl.durationS},
        intervals,
    });
    if(frozen.length > MAX_WORKOUT_BYTES) return fail(400, 'the workout is too large');

    const id = randomId();
    const joinKey = randomKey();
    const hostKey = randomKey();
    await env.DB.prepare(
        'INSERT INTO group_rides (id, title, workout, start_at, duration_s, host, join_hash, host_hash, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
    ).bind(id, title, frozen, startAt, tl.durationS, email ?? 'dev', await sha256(joinKey), await sha256(hostKey), now).run();

    const res = await stub(env, id).fetch('https://do/init', {
        method: 'POST',
        body: JSON.stringify({id, title, workout: JSON.parse(frozen), timeline: tl, startAt, lobbyS: LOBBY_S}),
    });
    if(!res.ok) return fail(500, 'could not start the ride');
    // guests have no household login, so their link is on the open
    // hostname (GUEST_ORIGIN); the host's stays on the household one
    return json({id, joinKey, hostKey, startAt, durationS: tl.durationS, guestOrigin: env.GUEST_ORIGIN || null});
}

// ---- join ----

async function info(request, env, id) {
    const ride = await getRide(env, id);
    if(!(await keyOk(ride, request.headers.get('X-Join-Key')))) return fail(404, 'no such ride, or the link is wrong');
    return json({...publicRide(ride), server: Date.now()});
}

async function join(request, env, id) {
    let body;
    try { body = await readJson(request, 8192); } catch(_) { return fail(400, 'bad request body'); }
    const ride = await getRide(env, id);
    if(!(await keyOk(ride, body.key))) return fail(404, 'no such ride, or the link is wrong');
    const now = Date.now();
    if(ride.closed) return fail(410, 'this ride is over');
    const opensAt = ride.start_at - LOBBY_S * 1000;
    if(now < opensAt) return fail(425, 'the lobby is not open yet', {opensAt, server: now});

    // a rider coming back (a reload, a second visit) keeps their id
    const previous = await verify(body.token, env.TOKEN_SECRET, now);
    const riderId = previous?.r === id ? previous.p : `r_${randomId(8)}`;
    const email = request.headers.get('Cf-Access-Authenticated-User-Email');
    const name = cleanName(body.name, email ? email.split('@')[0] : 'Rider');
    const host = typeof body.hostKey === 'string' && same(await sha256(body.hostKey), ride.host_hash);
    const exp = ride.start_at + ride.duration_s * 1000 + TOKEN_GRACE_MS;
    const token = await sign({r: id, p: riderId, n: name, h: host, exp}, env.TOKEN_SECRET);

    await env.DB.prepare(
        'INSERT INTO group_riders (ride_id, rider_id, name, joined) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (ride_id, rider_id) DO UPDATE SET name = ?3'
    ).bind(id, riderId, name, now).run();
    return json({riderId, token, host, name, server: now});
}

// ---- the WebSocket ----

async function socket(request, env, id) {
    if(request.headers.get('Upgrade') !== 'websocket') return fail(426, 'expected a websocket');
    const url = new URL(request.url);
    const who = await verify(url.searchParams.get('token'), env.TOKEN_SECRET);
    if(!who || who.r !== id) return fail(403, 'bad or expired token');
    return stub(env, id).fetch('https://do/ws', {
        headers: {'Upgrade': 'websocket', 'X-Rider': JSON.stringify({p: who.p, n: who.n, h: !!who.h})},
    });
}

// ---- video: a RealtimeKit participant for this rider ----

async function rtk(env, path, body) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.RTK_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}${path}`, {
        method: 'POST',
        headers: {'Authorization': `Bearer ${env.RTK_API_TOKEN}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if(!res.ok || out.success === false) throw new Error(`RealtimeKit ${path}: ${res.status} ${JSON.stringify(out.errors ?? out).slice(0, 300)}`);
    return out.data;
}

async function media(request, env, id) {
    let body;
    try { body = await readJson(request, 8192); } catch(_) { return fail(400, 'bad request body'); }
    const who = await verify(body.token, env.TOKEN_SECRET);
    if(!who || who.r !== id) return fail(403, 'bad or expired token');
    if(!env.RTK_ACCOUNT_ID || !env.RTK_APP_ID || !env.RTK_API_TOKEN) return fail(501, 'video is not set up for group rides');

    const rider = await env.DB.prepare('SELECT media_token FROM group_riders WHERE ride_id = ?1 AND rider_id = ?2').bind(id, who.p).first();
    if(rider?.media_token) return json({authToken: rider.media_token});

    try {
        let ride = await getRide(env, id);
        if(!ride.meeting_id) {
            const meeting = await rtk(env, '/meetings', {title: `Auuki · ${ride.title}`});
            // two riders arriving at once: the first meeting written wins
            await env.DB.prepare('UPDATE group_rides SET meeting_id = ?1 WHERE id = ?2 AND meeting_id IS NULL').bind(meeting.id, id).run();
            ride = await getRide(env, id);
        }
        const p = await rtk(env, `/meetings/${ride.meeting_id}/participants`, {
            name: who.n, preset_name: env.RTK_PRESET || 'group_call_participant', custom_participant_id: who.p,
        });
        await env.DB.prepare('UPDATE group_riders SET media_token = ?1 WHERE ride_id = ?2 AND rider_id = ?3').bind(p.token, id, who.p).run();
        return json({authToken: p.token});
    } catch(err) {
        console.error('group: media', err);
        return fail(502, 'the video service did not answer');
    }
}

// ---- routing ----

export async function route(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);   // api, group, :id, …
    if(url.pathname === '/api/host/group' && request.method === 'POST') return create(request, env);
    if(parts[0] !== 'api' || parts[1] !== 'group' || !parts[2]) return fail(404, 'not found');
    const id = parts[2];
    const rest = parts.slice(3).join('/');
    if(rest === '' && request.method === 'GET') return info(request, env, id);
    if(rest === 'join' && request.method === 'POST') return join(request, env, id);
    if(rest === 'ws') return socket(request, env, id);
    if(rest === 'media' && request.method === 'POST') return media(request, env, id);
    return fail(404, 'not found');
}

export default {
    async fetch(request, env) {
        try {
            return await route(request, env);
        } catch(err) {
            console.error('group:', err);
            return fail(500, 'something went wrong');
        }
    },
};
