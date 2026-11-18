//
// /api/rider — a infERGno rider's saved settings, keyed by their Strava
// account (rider, Nov 18, 2026: "keep a database of every person who logs in
// with strava all their settings, etc - essentially that's their username").
//
// The browser proves who it is with its Strava access token (the one it
// uploads with): the first time a token is seen this asks Strava whose it is
// (GET /athlete) and remembers the answer for an hour, by the token's hash.
//
//   GET     the rider's name and saved settings (404 before the first save)
//   PUT     {settings}: save them (a JSON object of string values)
//   DELETE  forget the rider (Disconnect)
//
// D1 `DB`, tables riders and rider_tokens (schema.sql). src/rider-sync.js is
// the other end.
//
const STRAVA_ATHLETE = 'https://www.strava.com/api/v3/athlete';
const TOKEN_TTL_MS = 3600 * 1000;
export const MAX_BYTES = 200 * 1024;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
});

export async function sha256(s) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// the Strava athlete behind this request's bearer token, or null
export async function whoIs(request, env, {fetcher = (...a) => fetch(...a), now = Date.now()} = {}) {
    const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
    if(!m) return null;
    const hash = await sha256(m[1]);
    const hit = await env.DB.prepare('SELECT athlete_id, name FROM rider_tokens WHERE token_hash = ? AND expires_at > ?').bind(hash, now).first();
    if(hit) return {id: hit.athlete_id, name: hit.name};
    const r = await fetcher(STRAVA_ATHLETE, {headers: {authorization: `Bearer ${m[1]}`}});
    if(!r.ok) return null;
    const a = await r.json().catch(() => null);
    if(!a?.id) return null;
    const name = [a.firstname, a.lastname].filter(Boolean).join(' ') || null;
    await env.DB.batch([
        env.DB.prepare('DELETE FROM rider_tokens WHERE expires_at < ?').bind(now),
        env.DB.prepare('INSERT OR REPLACE INTO rider_tokens (token_hash, athlete_id, name, expires_at) VALUES (?, ?, ?, ?)').bind(hash, a.id, name, now + TOKEN_TTL_MS),
    ]);
    return {id: a.id, name};
}

// settings must be a flat object of strings
export function validSettings(s) {
    if(!s || typeof s !== 'object' || Array.isArray(s)) return false;
    return Object.entries(s).every(([k, v]) => typeof k === 'string' && k.length <= 200 && typeof v === 'string');
}

export async function onRequest({request, env}, deps = {}) {
    if(!env.DB) return json({error: 'riders are not set up here'}, 503);
    const who = await whoIs(request, env, deps);
    if(!who) return json({error: 'connect Strava first'}, 401);
    const now = deps.now ?? Date.now();

    if(request.method === 'GET') {
        const row = await env.DB.prepare('SELECT name, settings, updated_at FROM riders WHERE athlete_id = ?').bind(who.id).first();
        if(!row) return json({athlete_id: who.id, name: who.name, settings: null, updated_at: 0}, 404);
        await env.DB.prepare('UPDATE riders SET seen_at = ?, name = ? WHERE athlete_id = ?').bind(now, who.name, who.id).run();
        return json({athlete_id: who.id, name: who.name ?? row.name, settings: JSON.parse(row.settings), updated_at: row.updated_at});
    }
    if(request.method === 'PUT') {
        const text = await request.text();
        if(text.length > MAX_BYTES) return json({error: 'too large'}, 413);
        let body;
        try { body = JSON.parse(text); } catch(e) { return json({error: 'not JSON'}, 400); }
        if(!validSettings(body?.settings)) return json({error: 'settings must be an object of strings'}, 400);
        await env.DB.prepare(`INSERT INTO riders (athlete_id, name, settings, created_at, updated_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(athlete_id) DO UPDATE SET name = excluded.name, settings = excluded.settings, updated_at = excluded.updated_at, seen_at = excluded.seen_at`)
            .bind(who.id, who.name, JSON.stringify(body.settings), now, now, now).run();
        return json({athlete_id: who.id, name: who.name, updated_at: now});
    }
    if(request.method === 'DELETE') {
        await env.DB.batch([
            env.DB.prepare('DELETE FROM riders WHERE athlete_id = ?').bind(who.id),
            env.DB.prepare('DELETE FROM rider_tokens WHERE athlete_id = ?').bind(who.id),
        ]);
        return json({deleted: true});
    }
    return json({error: 'method not allowed'}, 405);
}
