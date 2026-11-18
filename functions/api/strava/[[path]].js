//
// /api/strava/* — pERGatory's Strava relay (rider, Nov 17, 2026: uploads for
// family and friends, the pERGatory Strava app, client 127032).
//
// It stores nothing. A rider's tokens live in their own browser
// (src/models/strava-direct.js); this only does what needs the app's client
// secret, and passes the rest through to Strava with the rider's own token:
//
//   GET  config            the app's client id (not secret), for the Connect link
//   POST token   {code}    the code Strava returned  -> tokens + athlete
//   POST refresh {refresh_token}                      -> fresh tokens
//   POST deauthorize       revoke the rider's token at Strava (Disconnect)
//   POST uploads           a ride's .fit (multipart), as is
//   GET  uploads/:id       how that upload is getting on
//   PUT  activities/:id    name / description, after an edit
//   GET  athlete           who is connected
//
// Nothing else is forwarded. Secrets: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.
//

const OAUTH = 'https://www.strava.com/oauth';
const API = 'https://www.strava.com/api/v3';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
});

// which requests go through, as [method, pattern]
export const ROUTES = [
    ['POST', /^uploads$/],
    ['GET', /^uploads\/\d+$/],
    ['PUT', /^activities\/\d+$/],
    ['GET', /^athlete$/],
];
export const allowed = (method, path) => ROUTES.some(([m, re]) => m === method && re.test(path));

// only what the app needs from Strava's token answer
export function tokens(t = {}) {
    return {
        access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at,
        athlete: t.athlete ? {id: t.athlete.id, firstname: t.athlete.firstname, lastname: t.athlete.lastname} : undefined,
    };
}

async function oauthToken(env, params) {
    const r = await fetch(`${OAUTH}/token`, {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, ...params}),
    });
    const body = await r.json().catch(() => ({}));
    if(!r.ok) return json({error: body.message ?? `Strava answered ${r.status}`}, r.status === 400 || r.status === 401 ? 400 : 502);
    return json(tokens(body));
}

export async function onRequest({request, env, params}) {
    if(!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) return json({error: 'Strava is not set up on this server'}, 503);
    const path = (params.path ?? []).join('/');
    const method = request.method;

    if(path === 'config' && method === 'GET') return json({client_id: env.STRAVA_CLIENT_ID});
    if(path === 'token' && method === 'POST') {
        const {code} = await request.json().catch(() => ({}));
        if(!code) return json({error: 'no code'}, 400);
        return oauthToken(env, {code, grant_type: 'authorization_code'});
    }
    if(path === 'refresh' && method === 'POST') {
        const {refresh_token} = await request.json().catch(() => ({}));
        if(!refresh_token) return json({error: 'no refresh token'}, 400);
        return oauthToken(env, {refresh_token, grant_type: 'refresh_token'});
    }

    const auth = request.headers.get('authorization') ?? '';
    if(!/^Bearer [A-Za-z0-9]+$/.test(auth)) return json({error: 'no Strava token'}, 401);
    if(path === 'deauthorize' && method === 'POST') {
        const r = await fetch(`${OAUTH}/deauthorize`, {method: 'POST', headers: {authorization: auth}});
        return json({ok: r.ok}, r.ok ? 200 : r.status);
    }
    if(!allowed(method, path)) return json({error: 'not a route'}, 404);

    const init = {method, headers: {authorization: auth}};
    if(method === 'POST' || method === 'PUT') {
        const type = request.headers.get('content-type');
        if(type) init.headers['content-type'] = type;
        init.body = await request.arrayBuffer();
    }
    const r = await fetch(`${API}/${path}`, init);
    return new Response(await r.arrayBuffer(), {
        status: r.status,
        headers: {'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store'},
    });
}
