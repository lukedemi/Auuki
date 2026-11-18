//
// Strava, direct (this fork, Nov 17, 2026): ride uploads for family and
// friends, through the infERGno Strava app.
//
// The rider's tokens live in this browser only (localStorage), as their
// intervals.icu key does. Connect sends them to Strava's own approval page
// (strava.com/oauth/authorize, as Strava's brand guidelines require of the
// Connect button) asking for read,activity:write: upload, and the name on
// the account. Strava sends them back to this page with a one-time code,
// which /api/strava/token (functions/api/strava/[[path]].js) swaps for
// tokens with the app's secret; the relay stores nothing. Uploads, their
// status and later edits go through the same relay with the rider's token.
//
// infERGno only uploads. It reads nothing from Strava but the connected
// athlete's name.
//

const KEY = 'infergno:strava';
const STATE_KEY = 'infergno:strava:state';
export const SCOPE = 'read,activity:write';
const RELAY = './api/strava';
const POLL_MS = 2000;
const POLL_TRIES = 45;      // Strava usually processes a .fit in seconds; give it 90
// fetch looked up when used, not when a function is defined or called without one
const net = (...a) => globalThis.fetch(...a);
// the browser's log id (log.js), so the server's own log lines up with the app's
const visitorHeader = () => { try { return {'x-infergno-visitor': localStorage.getItem('infergno:visitor') ?? ''}; } catch(e) { return {}; } };

function storage() {
    try { return globalThis.localStorage; } catch(e) { return undefined; }
}

export function load() {
    try { return JSON.parse(storage()?.getItem(KEY) ?? 'null'); } catch(e) { return null; }
}
function save(v) {
    try { v ? storage()?.setItem(KEY, JSON.stringify(v)) : storage()?.removeItem(KEY); } catch(e) {}
}

export function isConnected() {
    const t = load();
    return !!(t?.refresh_token && /activity:write/.test(t.scope ?? ''));
}
export function athlete() {
    return load()?.athlete ?? null;
}
export function connectedAt() {
    return load()?.connected_at ?? 0;
}

// the Connect link: Strava's own page, back to this one
export function connectUrl(clientId, origin = location.origin, rand = () => crypto.getRandomValues(new Uint32Array(2)).join('')) {
    const state = `infergno-${rand()}`;
    try { storage()?.setItem(STATE_KEY, state); } catch(e) {}
    const q = new URLSearchParams({
        client_id: String(clientId), response_type: 'code', approval_prompt: 'auto',
        redirect_uri: `${origin}/`, scope: SCOPE, state,
    });
    return `https://www.strava.com/oauth/authorize?${q}`;
}

export async function config(fetcher = net) {
    const r = await fetcher(`${RELAY}/config`, {cache: 'no-store'});
    if(!r.ok) return null;
    return r.json().catch(() => null);
}

// Back from Strava: ?state=infergno-…&code=…&scope=… (or &error=access_denied).
// Returns null when the page was not opened by Strava for us.
export async function handleReturn(search = location.search, fetcher = net) {
    const p = new URLSearchParams(search);
    const state = p.get('state') ?? '';
    if(!state.startsWith('infergno-')) return null;
    let expected = null;
    try { expected = storage()?.getItem(STATE_KEY); storage()?.removeItem(STATE_KEY); } catch(e) {}
    if(state !== expected) return {ok: false, reason: 'this Strava answer was not for this browser; press Connect again'};
    if(p.get('error')) return {ok: false, reason: p.get('error') === 'access_denied' ? 'you declined on Strava' : p.get('error')};
    const scope = p.get('scope') ?? '';
    if(!/activity:write/.test(scope)) return {ok: false, reason: 'Strava did not grant upload permission; tick "Upload your activities" when you connect'};
    const r = await fetcher(`${RELAY}/token`, {method: 'POST', headers: {'content-type': 'application/json', ...visitorHeader()}, body: JSON.stringify({code: p.get('code')})});
    const body = await r.json().catch(() => ({}));
    if(!r.ok || !body.refresh_token) return {ok: false, reason: body.error ?? `the relay answered ${r.status}`};
    save({...body, scope, connected_at: Date.now()});
    return {ok: true, athlete: body.athlete};
}

// a token good for the next minute
export async function token(fetcher = net, now = () => Date.now() / 1000) {
    const t = load();
    if(!t?.refresh_token) throw new Error('Strava is not connected');
    if(t.access_token && t.expires_at - 60 > now()) return t.access_token;
    const r = await fetcher(`${RELAY}/refresh`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({refresh_token: t.refresh_token})});
    const body = await r.json().catch(() => ({}));
    if(!r.ok || !body.access_token) throw new Error(body.error ?? `Strava refresh failed (${r.status})`);
    save({...t, ...body, athlete: body.athlete ?? t.athlete});
    return body.access_token;
}

async function api(method, path, {body, headers = {}} = {}, fetcher = net) {
    const access = await token(fetcher);
    const r = await fetcher(`${RELAY}/${path}`, {method, headers: {authorization: `Bearer ${access}`, ...headers}, body});
    const out = await r.json().catch(() => ({}));
    if(!r.ok) throw Object.assign(new Error(out.message ?? out.error ?? `Strava answered ${r.status}`), {status: r.status, body: out});
    return out;
}

// "… duplicate of <a href='/activities/123'>…" -> 123
export function duplicateOf(error = '') {
    const m = /duplicate of .*?activities\/(\d+)/i.exec(String(error));
    return m ? m[1] : null;
}

// Upload a ride's .fit and wait for Strava to turn it into an activity.
export async function upload(blob, {name, description, externalId} = {}, {fetcher = net, wait = (ms) => new Promise((r) => setTimeout(r, ms))} = {}) {
    const form = new FormData();
    form.append('file', blob, 'infergno.fit');
    form.append('data_type', 'fit');
    form.append('trainer', '1');
    if(name) form.append('name', name);
    if(description) form.append('description', description);
    if(externalId) form.append('external_id', externalId);
    let up = await api('POST', 'uploads', {body: form}, fetcher);
    for(let i = 0; i < POLL_TRIES; i++) {
        if(up.activity_id) return {activityId: String(up.activity_id)};
        if(up.error) {
            const dup = duplicateOf(up.error);
            if(dup) return {activityId: dup, duplicate: true};
            throw new Error(up.error);
        }
        await wait(POLL_MS);
        up = await api('GET', `uploads/${up.id}`, {}, fetcher);
    }
    throw new Error('Strava is still processing the ride; it will be checked again');
}

export async function updateActivity(id, fields = {}, fetcher = net) {
    const body = {};
    if(fields.name) body.name = fields.name;
    if(typeof fields.description === 'string') body.description = fields.description;
    if(!Object.keys(body).length) return null;
    return api('PUT', `activities/${id}`, {body: JSON.stringify(body), headers: {'content-type': 'application/json'}}, fetcher);
}

// Disconnect: revoked at Strava, forgotten here
export async function disconnect(fetcher = net) {
    try {
        const access = await token(fetcher);
        await fetcher(`${RELAY}/deauthorize`, {method: 'POST', headers: {authorization: `Bearer ${access}`}});
    } catch(e) {}
    save(null);
}

export const activityUrl = (id) => `https://www.strava.com/activities/${id}`;

export default Object.freeze({
    load, isConnected, athlete, connectedAt, connectUrl, config, handleReturn, token, upload, updateActivity,
    disconnect, duplicateOf, activityUrl, SCOPE,
});
