//
// /api/admin/* — the log, read back, for the household only (Access covers
// /api/admin and /admin on infergno.com, and this checks the signature too).
//
//   GET summary                          visitors and events in the last day and week, riders, group rides
//   GET visitors?limit                   every visitor, the most recent first
//   GET events?visitor&kind&q&before&limit   the events, newest first
//
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
const n = (v, d, max) => Math.max(1, Math.min(max, Number(v) || d));

export async function onRequestGet({request, env, params}) {
    if(!request.headers.get('cf-access-jwt-assertion')) return json({error: 'household only'}, 403);
    if(!env.DB) return json({error: 'no database'}, 503);
    const url = new URL(request.url);
    const q = url.searchParams;
    const route = (params.path ?? []).join('/');
    const now = Date.now(), day = 86400000;

    if(route === 'summary') {
        const one = (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
        const [v1, v7, e1, e7, riders, rides, errors] = await Promise.all([
            one('SELECT COUNT(*) AS n FROM visitors WHERE last_seen > ?', now - day),
            one('SELECT COUNT(*) AS n FROM visitors WHERE last_seen > ?', now - 7 * day),
            one('SELECT COUNT(*) AS n FROM events WHERE ts > ?', now - day),
            one('SELECT COUNT(*) AS n FROM events WHERE ts > ?', now - 7 * day),
            one('SELECT COUNT(*) AS n FROM riders'),
            one("SELECT COUNT(*) AS n FROM events WHERE kind = 'group:create' AND ts > ?", now - 30 * day),
            one("SELECT COUNT(*) AS n FROM events WHERE kind = 'error' AND ts > ?", now - day),
        ]);
        return json({visitors: {day: v1?.n ?? 0, week: v7?.n ?? 0}, events: {day: e1?.n ?? 0, week: e7?.n ?? 0},
            riders: riders?.n ?? 0, groupRides30d: rides?.n ?? 0, errorsDay: errors?.n ?? 0, server: now});
    }
    if(route === 'visitors') {
        const {results} = await env.DB.prepare('SELECT * FROM visitors ORDER BY last_seen DESC LIMIT ?').bind(n(q.get('limit'), 200, 1000)).all();
        return json({visitors: results ?? []});
    }
    if(route === 'events') {
        const where = [], args = [];
        if(q.get('visitor')) { where.push('visitor = ?'); args.push(q.get('visitor')); }
        if(q.get('kind')) { where.push('kind LIKE ?'); args.push(`${q.get('kind')}%`); }
        if(q.get('q')) { where.push('(who LIKE ? OR data LIKE ? OR path LIKE ?)'); const like = `%${q.get('q')}%`; args.push(like, like, like); }
        if(q.get('before')) { where.push('ts < ?'); args.push(Number(q.get('before'))); }
        const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC, id DESC LIMIT ?`;
        const {results} = await env.DB.prepare(sql).bind(...args, n(q.get('limit'), 200, 1000)).all();
        return json({events: results ?? []});
    }
    return json({error: 'not a route'}, 404);
}
