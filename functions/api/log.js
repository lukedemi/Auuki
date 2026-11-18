//
// /api/log — what people do on infERGno (rider, Nov 18, 2026: "I want logging
// built into the whole site so I can see everything anybody is doing").
//
//   POST {visitor, session, who, events: [{t, kind, data, path}]}
//        the app's events (src/log.js), in batches; anyone may send
//
// record(env, request, ev) is also how the server's own functions log what
// they can vouch for (source "server"): a Strava connect, a first settings
// save, a group ride created. D1 `DB`, tables events and visitors
// (schema.sql); read at /admin. Rows older than 180 days are dropped now and
// then.
//
export const KEEP_MS = 180 * 86400 * 1000;
const MAX_BODY = 64 * 1024, MAX_EVENTS = 60, MAX_DATA = 2048;

const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : v == null ? null : String(v).slice(0, n));
const kindOk = (k) => typeof k === 'string' && /^[a-z0-9:_.-]{1,40}$/i.test(k);

// where the request came from, as Cloudflare saw it (no addresses are kept)
const urlOf = (request) => { try { return new URL(request.url); } catch(e) { return null; } };
export function place(request) {
    const cf = request?.cf ?? {};
    return {country: str(cf.country, 8), city: str(cf.city, 60), ua: str(request?.headers?.get?.('user-agent'), 300), host: str(urlOf(request)?.host, 80)};
}

function row(env, ev, where) {
    const data = ev.data == null ? null : JSON.stringify(ev.data).slice(0, MAX_DATA);
    return env.DB.prepare('INSERT INTO events (ts, visitor, session, who, source, kind, data, path, host, country, city, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(ev.ts, str(ev.visitor, 64), str(ev.session, 64), str(ev.who, 120), ev.source, ev.kind, data, str(ev.path, 200), where.host, where.country, where.city, where.ua);
}
function visitorRow(env, visitor, who, n, ts, where) {
    return env.DB.prepare(`INSERT INTO visitors (visitor, who, first_seen, last_seen, events, country, city, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(visitor) DO UPDATE SET who = COALESCE(excluded.who, visitors.who), last_seen = excluded.last_seen,
        events = visitors.events + excluded.events, country = excluded.country, city = excluded.city, ua = excluded.ua`)
        .bind(str(visitor, 64), str(who, 120), ts, ts, n, where.country, where.city, where.ua);
}

// one event the server itself saw; never fails the request it is part of
export async function record(env, request, {kind, who = null, visitor = null, data = null, path = null}) {
    if(!env?.DB) return;
    try {
        const where = place(request);
        const ts = Date.now();
        const stmts = [row(env, {ts, visitor, session: null, who, source: 'server', kind, data, path: path ?? urlOf(request)?.pathname ?? null}, where)];
        if(visitor) stmts.push(visitorRow(env, visitor, who, 1, ts, where));
        await env.DB.batch(stmts);
    } catch(e) {}
}

export async function onRequestPost({request, env}) {
    if(!env.DB) return json({error: 'logging is not set up here'}, 503);
    const text = await request.text();
    if(text.length > MAX_BODY) return json({error: 'too large'}, 413);
    let body;
    try { body = JSON.parse(text); } catch(e) { return json({error: 'not JSON'}, 400); }
    const visitor = str(body?.visitor, 64);
    if(!visitor || !Array.isArray(body.events)) return json({error: 'visitor and events'}, 400);
    const now = Date.now();
    const events = body.events.slice(0, MAX_EVENTS).filter((e) => kindOk(e?.kind));
    if(!events.length) return json({ok: true, kept: 0});
    const where = place(request);
    const who = str(body.who, 120);
    const stmts = events.map((e) => row(env, {
        // the browser's clock, kept within a day of the server's
        ts: Math.abs((Number(e.t) || now) - now) < 86400000 ? Math.round(Number(e.t) || now) : now,
        visitor, session: body.session, who, source: 'app', kind: e.kind, data: e.data ?? null, path: e.path,
    }, where));
    stmts.push(visitorRow(env, visitor, who, events.length, now, where));
    if(Math.random() < 0.01) stmts.push(env.DB.prepare('DELETE FROM events WHERE ts < ?').bind(now - KEEP_MS));
    await env.DB.batch(stmts);
    return json({ok: true, kept: events.length});
}
