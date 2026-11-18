/**
 * @jest-environment jsdom
 */
import { Log, visitorId } from '../src/log.js';
import { onRequestPost as logPost, record } from '../functions/api/log.js';
import { onRequestPost as hostPost, hostOf, notify } from '../functions/api/host/group.js';
import { onRequestGet as adminGet } from '../functions/api/admin/[[path]].js';

class Res { constructor(body, init = {}) { this._b = body; this.status = init.status ?? 200; this.ok = this.status < 400; } async json() { return JSON.parse(this._b); } }
globalThis.Response = Res;
// the Workers runtime has these; jsdom does not
globalThis.Headers = class { constructor(i = {}) { this.m = new Map(Object.entries(i).map(([k, v]) => [k.toLowerCase(), v])); } set(k, v) { this.m.set(k.toLowerCase(), v); } get(k) { return this.m.get(k.toLowerCase()) ?? null; } };
globalThis.Request = class { constructor(url, init = {}) { this.url = url; this.method = init.method; this.headers = init.headers; this.body = init.body; } };
const headers = (h) => ({get: (k) => h[k.toLowerCase()] ?? null});
const req = (url, {method = 'POST', h = {}, body = ''} = {}) => ({url, method, headers: headers(h), text: async () => body, cf: {country: 'US', city: 'Lancaster'}});
function fakeDB() {
    const rows = [];
    const prepare = (sql) => ({bind: (...a) => ({sql, a, run: async () => { rows.push({sql, a}); }, first: async () => null, all: async () => ({results: []})})});
    return {prepare, batch: async (s) => { rows.push(...s); }, rows};
}

describe('the log', () => {
    test('the browser batches its events under one anonymous id', () => {
        const sent = [];
        const log = Log({send: (b) => sent.push(b), now: () => 1000});
        log.event('load', {ref: null});
        log.event('page', {page: 'home'});
        log.flush();
        expect(sent.length).toBe(1);
        expect(sent[0].visitor).toBe(visitorId());
        expect(visitorId()).toBe(sent[0].visitor);                       // the same id every time
        expect(sent[0].events.map((e) => e.kind)).toEqual(['load', 'page']);
        log.flush();
        expect(sent.length).toBe(1);                                      // nothing new, nothing sent
        for(let i = 0; i < 30; i++) log.error('boom');
        log.flush();
        expect(sent[1].events.length).toBe(20);                          // errors are capped
    });

    test('/api/log keeps good events with where they came from, and drops the rest', async () => {
        const env = {DB: fakeDB()};
        const now = Date.now();
        const r = await logPost({request: req('https://infergno.com/api/log', {body: JSON.stringify({visitor: 'v1', session: 's1', who: 'Luke Demi (strava 7)',
            events: [{t: now, kind: 'load'}, {t: now, kind: 'bad kind!'}, {t: now - 5 * 86400000, kind: 'ride:start', data: {workout: 'X'}}]})}), env});
        expect((await r.json()).kept).toBe(2);
        const events = env.DB.rows.filter((x) => x.sql.startsWith('INSERT INTO events'));
        expect(events.map((x) => x.a[5])).toEqual(['load', 'ride:start']);
        expect(events[0].a[4]).toBe('app');
        expect(events[0].a.slice(8, 11)).toEqual(['infergno.com', 'US', 'Lancaster']);
        expect(Math.abs(events[1].a[0] - now)).toBeLessThan(1000);       // a clock days off is replaced by the server's
        expect(env.DB.rows.some((x) => x.sql.startsWith('INSERT INTO visitors'))).toBe(true);
        expect((await logPost({request: req('https://infergno.com/api/log', {body: 'x'.repeat(70000)}), env})).status).toBe(413);
        expect((await logPost({request: req('https://infergno.com/api/log', {body: JSON.stringify({events: []})}), env})).status).toBe(400);
    });

    test('the server logs what it saw, and a broken database never breaks the request', async () => {
        const env = {DB: fakeDB()};
        await record(env, req('https://infergno.com/api/host/group'), {kind: 'group:create', who: 'Jeff'});
        expect(env.DB.rows[0].a[4]).toBe('server');
        await expect(record({DB: {prepare: () => { throw new Error('down'); }}}, req('x'), {kind: 'x'})).resolves.toBeUndefined();
    });

    test('/api/admin is for the household only', async () => {
        expect((await adminGet({request: req('https://infergno.com/api/admin/summary', {method: 'GET'}), env: {DB: fakeDB()}, params: {path: ['summary']}})).status).toBe(403);
        const ok = await adminGet({request: req('https://infergno.com/api/admin/events', {method: 'GET', h: {'cf-access-jwt-assertion': 'jwt'}}), env: {DB: fakeDB()}, params: {path: ['events']}});
        expect(ok.status).toBe(200);
    });
});

describe('hosting a group ride', () => {
    test('the host is the household, or a Strava rider; nobody else', async () => {
        expect(await hostOf(req('x', {h: {'cf-access-jwt-assertion': 'j', 'cf-access-authenticated-user-email': 'luke@x'}}), {})).toEqual({id: 'luke@x', name: 'luke', via: 'household'});
        expect(await hostOf(req('x', {h: {'cf-access-authenticated-user-email': 'forged@x'}}), {})).toBe(null);   // no signature, no household
        expect(await hostOf(req('x'), {DB: fakeDB()}, {fetcher: async () => ({ok: false})})).toBe(null);
    });

    test('no sign-in: told to sign in with Strava, and nothing reaches the Worker', async () => {
        let called = false;
        const r = await hostPost({request: req('https://infergno.com/api/host/group', {body: '{}'}), env: {DB: fakeDB(), GROUP_API: {fetch: async () => { called = true; }}}});
        expect(r.status).toBe(401);
        expect((await r.json()).signIn).toBe('strava');
        expect(called).toBe(false);
    });

    test('a household host: the Worker gets the host, the phone gets the push, the log gets the ride', async () => {
        const pushes = [], sentTo = [];
        globalThis.fetch = async (url, opts) => { pushes.push({url, body: JSON.parse(opts.body)}); return {ok: true}; };
        const env = {DB: fakeDB(), HA_URL: 'https://ha.example/', HA_TOKEN: 't', GROUP_API: {fetch: async (r) => { sentTo.push(r.headers.get('Cf-Access-Authenticated-User-Email')); return new Res(JSON.stringify({id: 'abc', joinKey: 'K', hostKey: 'H', startAt: Date.now() + 3600000, durationS: 3600, guestOrigin: 'https://ride.d3-mi.com'})); }}};
        const r = await hostPost({request: req('https://infergno.com/api/host/group', {h: {'cf-access-jwt-assertion': 'j', 'cf-access-authenticated-user-email': 'luke@x'}, body: JSON.stringify({title: 'Tuesday spin', workout: {meta: {name: 'Sweet Spot 3×15 min'}}})}), env});
        const out = await r.json();
        expect(r.status).toBe(200);
        expect(sentTo).toEqual(['luke@x']);
        expect(out.guestOrigin).toBe('https://infergno.com');            // guests ride on the public site
        expect(pushes[0].url).toBe('https://ha.example/api/services/notify/pushover_debug');
        expect(pushes[0].body.title).toBe('infERGno group ride: Tuesday spin');
        expect(pushes[0].body.message).toMatch(/^luke is hosting Tuesday spin on infergno\.com, .*, 60 min\.$/);
        expect(pushes[0].body.data).toEqual({priority: 0, url: 'https://infergno.com/?g=abc#k=K', url_title: 'Open the ride'});
        expect(env.DB.rows.some((x) => x.sql.startsWith('INSERT INTO events') && x.a[5] === 'group:create')).toBe(true);
    });

    test('no Home Assistant, no push, no failure', async () => {
        expect(await notify({}, {title: 'x', host: 'y', startAt: 0, minutes: 1, link: 'l', site: 's'})).toBe(false);
    });
});
