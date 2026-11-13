//
// POST /api/trace — the app's debug traces into D1 `auuki` (schema.sql).
//
// The app (src/trace.js) sends a batch every ~10 s:
//   {session, meta: {ua, version, started}, rows: [{ts, kind, data}]}
// The whole site sits behind Cloudflare Access, so only the household
// reaches this; Access names the sender in a header, kept as `who`.
//
// Old rows go after 30 days, swept now and then on a write.
//

const MAX_ROWS = 1000;        // per batch
const MAX_DATA = 8000;        // characters of JSON per row
const KEEP_MS  = 30 * 24 * 3600 * 1000;
const KINDS    = new Set(['state', 'log', 'warn', 'error', 'event', 'mark']);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
});

export function clean(body, now = Date.now()) {
    if(!body || typeof body !== 'object') return {error: 'bad body'};
    const session = String(body.session ?? '').slice(0, 64);
    if(!/^[A-Za-z0-9_{}-]{8,64}$/.test(session)) return {error: 'bad session'};
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
    const out = [];
    for(const r of rows) {
        if(!r || typeof r !== 'object') continue;
        const kind = KINDS.has(r.kind) ? r.kind : 'event';
        const ts = Number.isFinite(r.ts) ? Math.round(r.ts) : now;
        let data = r.data === undefined ? null : JSON.stringify(r.data);
        if(data && data.length > MAX_DATA) data = JSON.stringify({truncated: data.slice(0, MAX_DATA)});
        out.push({ts, kind, data});
    }
    const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
    return {
        session,
        rows: out,
        meta: {
            ua:      String(meta.ua ?? '').slice(0, 300),
            version: String(meta.version ?? '').slice(0, 80),
            started: Number.isFinite(meta.started) ? Math.round(meta.started) : now,
        },
    };
}

export async function onRequestPost({request, env}) {
    if(!env.DB) return json({error: 'no D1 binding'}, 500);
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'bad json'}, 400); }
    const c = clean(body);
    if(c.error) return json({error: c.error}, 400);

    const who = request.headers.get('cf-access-authenticated-user-email') ?? '';
    const last = c.rows.reduce((a, r) => Math.max(a, r.ts), c.meta.started);
    const stmts = [
        env.DB.prepare(`INSERT INTO sessions (session, started, last, who, ua, version, rows) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session) DO UPDATE SET last = MAX(last, excluded.last), rows = rows + excluded.rows,
            who = COALESCE(NULLIF(excluded.who, ''), who), version = excluded.version`)
            .bind(c.session, c.meta.started, last, who, c.meta.ua, c.meta.version, c.rows.length),
        ...c.rows.map((r) => env.DB.prepare('INSERT INTO traces (session, ts, kind, data) VALUES (?, ?, ?, ?)')
            .bind(c.session, r.ts, r.kind, r.data)),
    ];
    if(Math.random() < 0.02) {
        const cutoff = Date.now() - KEEP_MS;
        stmts.push(env.DB.prepare('DELETE FROM traces WHERE ts < ?').bind(cutoff));
        stmts.push(env.DB.prepare('DELETE FROM sessions WHERE last < ?').bind(cutoff));
    }
    await env.DB.batch(stmts);
    return json({ok: true, rows: c.rows.length});
}

export function onRequestGet() {
    return json({ok: true, hint: 'POST traces here; read them with scripts/traces.mjs'});
}
