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

// Nov 26, 2026, for the Strava launch: what was clicked, the browser, and a push on a Strava connect
import { clickLabel, browserOf } from '../src/log.js';
import { push, deviceOf } from '../functions/api/log.js';
import { connectPush } from '../functions/api/strava/[[path]].js';

describe('what a click was on', () => {
    const dom = (html) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); return d; };
    test('a button by its words, a workout card by its name, a link with its href', () => {
        const d = dom(`<button class="ht--ride" data-act="ride">▶ Ride</button>
            <button class="ht--card" data-id="w1"><div class="g"><svg></svg></div><div><div class="name">Threshold 5×5 min</div><div class="kind">Threshold</div></div></button>
            <a href="./privacy">Privacy</a><button aria-label="Workout intensity up">+</button>
            <input type="search" value="vo2"><div class="plain">nothing</div>`);
        expect(clickLabel(d.querySelector('.ht--ride'))).toEqual({el: '▶ Ride', tag: '[ride]', href: undefined});
        expect(clickLabel(d.querySelector('.kind')).el).toBe('Threshold 5×5 min');
        expect(clickLabel(d.querySelector('a'))).toMatchObject({el: 'Privacy', href: './privacy'});
        expect(clickLabel(d.querySelector('[aria-label]')).el).toBe('Workout intensity up');
        expect(clickLabel(d.querySelector('input'))).toBe(null);        // never what is typed
        expect(clickLabel(d.querySelector('.plain'))).toBe(null);
    });
});

describe('the browser', () => {
    test('iOS in the Strava app cannot ride', () => {
        const b = browserOf({userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Strava/401.0.0'});
        expect(b).toEqual({bluetooth: false, mobile: true, inApp: 'strava'});
        expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148 Strava/401.0.0')).toBe('Strava app (iOS)');
    });
    test('desktop Chrome can', () => {
        const b = browserOf({userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', bluetooth: {}});
        expect(b).toEqual({bluetooth: true, mobile: false, inApp: null});
        expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0 Safari/537.36')).toBe('Mac Chrome');
    });
});

describe('a Strava connect pushes to the rider', () => {
    test('who, from where, on what, with their profile', () => {
        const p = connectPush({id: 123, firstname: 'Ada', lastname: 'L'}, {city: 'Leeds', country: 'GB', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36'}, 'https://infergno.com');
        expect(p).toEqual({title: 'Ada L connected Strava', message: 'On infergno.com · from Leeds, GB · on Windows Chrome.',
            url: 'https://www.strava.com/athletes/123', urlTitle: 'Their Strava profile'});
    });
    test('through Home Assistant, priority 0, and never throws', async () => {
        const calls = [];
        const ok = await push({HA_URL: 'https://ha.example/', HA_TOKEN: 't'}, {title: 'T', message: 'M', url: 'u', urlTitle: 'U'},
            async (url, init) => { calls.push([url, JSON.parse(init.body)]); return {ok: true}; });
        expect(ok).toBe(true);
        expect(calls[0][0]).toBe('https://ha.example/api/services/notify/pushover_debug');
        expect(calls[0][1]).toEqual({title: 'T', message: 'M', data: {priority: 0, url: 'u', url_title: 'U'}});
        expect(await push({HA_URL: 'x', HA_TOKEN: 't'}, {title: 'T', message: 'M'}, async () => { throw new Error('down'); })).toBe(false);
        expect(await push({}, {title: 'T', message: 'M'})).toBe(false);
    });
});
