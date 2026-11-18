/**
 * @jest-environment jsdom
 */

import strava, { connectUrl, handleReturn, token, upload, duplicateOf, updateActivity, disconnect, SCOPE } from '../src/models/strava-direct.js';
import { allowed, tokens, onRequest } from '../functions/api/strava/[[path]].js';

global.Response = global.Response ?? class { constructor(body, init = {}) { this._b = body; this.status = init.status ?? 200; this.ok = this.status < 400; this.headers = new Map(Object.entries(init.headers ?? {})); } async json() { return JSON.parse(typeof this._b === 'string' ? this._b : new TextDecoder().decode(this._b)); } };

const req = (url, {method = 'GET', body, headers = {}} = {}) => ({
    url, method, headers: {get: (k) => headers[k.toLowerCase()] ?? null},
    json: async () => JSON.parse(body), arrayBuffer: async () => new TextEncoder().encode(body ?? '').buffer,
});
const ok = (body) => ({ok: true, status: 200, json: async () => body});
const KEY = 'pergatory:strava';

describe('connecting a rider\'s Strava', () => {
    beforeEach(() => localStorage.clear());

    test('the Connect link is Strava\'s own page, upload rights only, back to this site', () => {
        const u = new URL(connectUrl(127032, 'https://pergatory.d3-mi.com', () => '42'));
        expect(u.origin + u.pathname).toBe('https://www.strava.com/oauth/authorize');
        expect(u.searchParams.get('client_id')).toBe('127032');
        expect(u.searchParams.get('scope')).toBe('read,activity:write');
        expect(u.searchParams.get('redirect_uri')).toBe('https://pergatory.d3-mi.com/');
        expect(u.searchParams.get('state')).toBe('pergatory-42');
        expect(SCOPE).toBe('read,activity:write');
    });

    test('back from Strava: the code becomes tokens kept in this browser', async () => {
        connectUrl(1, 'https://x', () => '7');
        const calls = [];
        const res = await handleReturn('?state=pergatory-7&code=abc&scope=read,activity:write', async (url, opts) => {
            calls.push([url, JSON.parse(opts.body)]);
            return ok({access_token: 'A', refresh_token: 'R', expires_at: 2e9, athlete: {firstname: 'Jeff', lastname: 'Demi'}});
        });
        expect(res).toEqual({ok: true, athlete: {firstname: 'Jeff', lastname: 'Demi'}});
        expect(calls).toEqual([['./api/strava/token', {code: 'abc'}]]);
        expect(strava.isConnected()).toBe(true);
        expect(strava.athlete().firstname).toBe('Jeff');
    });

    test('not ours, a forged state, a refusal, or no upload rights: nothing is stored', async () => {
        expect(await handleReturn('?state=strava_1&code=x')).toBe(null);           // upstream's own OAuth
        connectUrl(1, 'https://x', () => '7');
        expect((await handleReturn('?state=pergatory-8&code=x&scope=activity:write')).ok).toBe(false);
        connectUrl(1, 'https://x', () => '7');
        expect((await handleReturn('?state=pergatory-7&error=access_denied')).reason).toMatch(/declined/);
        connectUrl(1, 'https://x', () => '7');
        expect((await handleReturn('?state=pergatory-7&code=x&scope=read')).reason).toMatch(/upload permission/);
        expect(strava.isConnected()).toBe(false);
    });
});

describe('uploading a ride', () => {
    beforeEach(() => localStorage.setItem(KEY, JSON.stringify({access_token: 'old', refresh_token: 'R', expires_at: 0, scope: 'read,activity:write', athlete: {firstname: 'J'}})));

    test('an expired token is refreshed first; the upload is waited for', async () => {
        const seen = [];
        const fetcher = async (url, opts = {}) => {
            seen.push([opts.method ?? 'GET', url, opts.headers?.authorization]);
            if(url.endsWith('/refresh')) return ok({access_token: 'new', refresh_token: 'R2', expires_at: 9e9});
            if(url.endsWith('/uploads')) return ok({id: 5, status: 'Your activity is still being processed.'});
            if(url.endsWith('/uploads/5')) return ok({id: 5, activity_id: 123});
        };
        const res = await upload(new Blob(['fit']), {name: 'Ride', description: 'notes', externalId: 'pergatory-1'}, {fetcher, wait: async () => {}});
        expect(res).toEqual({activityId: '123'});
        expect(seen.map((s) => s.slice(0, 2))).toEqual([['POST', './api/strava/refresh'], ['POST', './api/strava/uploads'], ['GET', './api/strava/uploads/5']]);
        expect(seen[1][2]).toBe('Bearer new');
        expect(JSON.parse(localStorage.getItem(KEY)).refresh_token).toBe('R2');
    });

    test('a ride Strava already has is its activity, not an error', async () => {
        expect(duplicateOf("pergatory.fit duplicate of <a href='/activities/987654'>Ride</a>")).toBe('987654');
        const fetcher = async (url) => (url.endsWith('/refresh') ? ok({access_token: 'n', refresh_token: 'R', expires_at: 9e9}) : ok({id: 6, error: "pergatory.fit duplicate of <a href='/activities/42'>x</a>"}));
        expect(await upload(new Blob(['fit']), {}, {fetcher, wait: async () => {}})).toEqual({activityId: '42', duplicate: true});
    });

    test('edits go up as name and description; Disconnect revokes and forgets', async () => {
        const seen = [];
        const fetcher = async (url, opts = {}) => { seen.push([opts.method, url, opts.body]); return url.endsWith('/refresh') ? ok({access_token: 'n', refresh_token: 'R', expires_at: 9e9}) : ok({}); };
        await updateActivity('123', {name: 'Better name', description: 'legs good'}, fetcher);
        expect(seen[1]).toEqual(['PUT', './api/strava/activities/123', JSON.stringify({name: 'Better name', description: 'legs good'})]);
        await disconnect(fetcher);
        expect(seen[2][1]).toBe('./api/strava/deauthorize');
        expect(localStorage.getItem(KEY)).toBe(null);
    });
});

describe('the relay', () => {
    test('passes only what pERGatory needs', () => {
        expect(allowed('POST', 'uploads')).toBe(true);
        expect(allowed('GET', 'uploads/12')).toBe(true);
        expect(allowed('PUT', 'activities/12')).toBe(true);
        expect(allowed('GET', 'athlete')).toBe(true);
        expect(allowed('GET', 'activities')).toBe(false);          // reading rides: no
        expect(allowed('GET', 'athlete/activities')).toBe(false);
        expect(allowed('DELETE', 'activities/12')).toBe(false);
    });
    test('keeps only the tokens and the name from Strava\'s answer', () => {
        expect(tokens({access_token: 'a', refresh_token: 'r', expires_at: 1, token_type: 'Bearer', athlete: {id: 9, firstname: 'J', lastname: 'D', city: 'X', weight: 70}}))
            .toEqual({access_token: 'a', refresh_token: 'r', expires_at: 1, athlete: {id: 9, firstname: 'J', lastname: 'D'}});
    });
    test('without its secrets it says so; with them it swaps a code using the secret', async () => {
        expect((await onRequest({request: req('https://x/api/strava/config'), env: {}, params: {path: ['config']}})).status).toBe(503);
        const sent = [];
        global.fetch = jest.fn(async (url, opts) => { sent.push([url, String(opts.body)]); return {ok: true, status: 200, json: async () => ({access_token: 'a', refresh_token: 'r', expires_at: 1})}; });
        const env = {STRAVA_CLIENT_ID: '127032', STRAVA_CLIENT_SECRET: 'shh'};
        const r = await onRequest({request: req('https://x/api/strava/token', {method: 'POST', body: JSON.stringify({code: 'c'})}), env, params: {path: ['token']}});
        expect(r.status).toBe(200);
        expect(sent[0][0]).toBe('https://www.strava.com/oauth/token');
        expect(sent[0][1]).toContain('client_secret=shh');
        expect(sent[0][1]).toContain('grant_type=authorization_code');
        const denied = await onRequest({request: req('https://x/api/strava/athlete/activities', {headers: {authorization: 'Bearer abc'}}), env, params: {path: ['athlete', 'activities']}});
        expect(denied.status).toBe(404);
        delete global.fetch;
    });
});
