/**
 * @jest-environment jsdom
 */
globalThis.__AUUKI_NO_RIDERSYNC__ = true;
import { onRequest, whoIs, validSettings, MAX_BYTES } from '../functions/api/rider.js';
import { RiderSync, synced, snapshot } from '../src/rider-sync.js';
import { StartPage } from '../src/start-page.js';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
if(!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', {value: webcrypto, configurable: true});
globalThis.TextEncoder ??= TextEncoder;

class Res { constructor(body, init = {}) { this._b = body; this.status = init.status ?? 200; this.ok = this.status < 400; } async json() { return JSON.parse(this._b); } }
globalThis.Response = Res;

// a D1 that understands just the statements rider.js sends
function fakeDB() {
    const riders = new Map(), tokens = new Map(), logged = [];
    const run = (sql, a) => {
        if(/^SELECT athlete_id, name FROM rider_tokens/.test(sql)) { const t = tokens.get(a[0]); return t && t.expires_at > a[1] ? t : null; }
        if(/^DELETE FROM rider_tokens WHERE expires_at/.test(sql)) { for(const [k, t] of tokens) if(t.expires_at < a[0]) tokens.delete(k); return null; }
        if(/^INSERT OR REPLACE INTO rider_tokens/.test(sql)) { tokens.set(a[0], {athlete_id: a[1], name: a[2], expires_at: a[3]}); return null; }
        if(/^SELECT name, settings, updated_at FROM riders/.test(sql)) return riders.get(a[0]) ?? null;
        if(/^UPDATE riders SET seen_at/.test(sql)) { const r = riders.get(a[2]); if(r) Object.assign(r, {seen_at: a[0], name: a[1]}); return null; }
        if(/^INSERT INTO riders/.test(sql)) { const old = riders.get(a[0]); riders.set(a[0], {name: a[1], settings: a[2], created_at: old?.created_at ?? a[3], updated_at: a[4], seen_at: a[5]}); return null; }
        if(/^DELETE FROM riders/.test(sql)) { riders.delete(a[0]); return null; }
        if(/^DELETE FROM rider_tokens WHERE athlete_id/.test(sql)) { for(const [k, t] of tokens) if(t.athlete_id === a[0]) tokens.delete(k); return null; }
        if(/^SELECT 1 AS x FROM riders/.test(sql)) return riders.has(a[0]) ? {x: 1} : null;
        if(/^INSERT INTO (events|visitors)/.test(sql)) { logged.push(sql.startsWith('INSERT INTO events') ? a[5] : null); return null; }
        throw new Error(`unexpected SQL: ${sql}`);
    };
    const prepare = (sql) => ({bind: (...a) => ({first: async () => run(sql.trim(), a), run: async () => run(sql.trim(), a), _go: () => run(sql.trim(), a)})});
    return {prepare, batch: async (stmts) => stmts.map((s) => s._go()), _riders: riders, _tokens: tokens, _logged: logged};
}
const req = (method, token, body) => ({method, headers: {get: (k) => (k.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null)}, text: async () => body ?? ''});
const strava = (map) => { const calls = []; const f = async (url, opts) => { const t = opts.headers.authorization.split(' ')[1]; calls.push(t); const a = map[t]; return {ok: !!a, json: async () => a}; }; f.calls = calls; return f; };

describe('/api/rider', () => {
    test('knows a rider by their Strava token, asking Strava once an hour', async () => {
        const env = {DB: fakeDB()};
        const fetcher = strava({tok: {id: 42, firstname: 'Jeff', lastname: 'D'}});
        expect(await whoIs(req('GET', 'tok'), env, {fetcher, now: 1000})).toEqual({id: 42, name: 'Jeff D'});
        expect(await whoIs(req('GET', 'tok'), env, {fetcher, now: 2000})).toEqual({id: 42, name: 'Jeff D'});
        expect(fetcher.calls.length).toBe(1);
        expect([...env.DB._tokens.keys()][0]).toMatch(/^[0-9a-f]{64}$/);    // the hash, never the token
        expect(await whoIs(req('GET', 'bad'), env, {fetcher, now: 3000})).toBe(null);
        expect(await whoIs(req('GET', null), env, {fetcher})).toBe(null);
    });

    test('saves, returns and forgets a rider\'s settings', async () => {
        const env = {DB: fakeDB()};
        const fetcher = strava({tok: {id: 7, firstname: 'Luke'}});
        expect((await onRequest({request: req('GET', 'nope'), env}, {fetcher})).status).toBe(401);
        expect((await onRequest({request: req('GET', 'tok'), env}, {fetcher, now: 10})).status).toBe(404);
        const put = await onRequest({request: req('PUT', 'tok', JSON.stringify({settings: {ftp: '295'}})), env}, {fetcher, now: 20});
        expect(await put.json()).toEqual({athlete_id: 7, name: 'Luke', updated_at: 20});
        const got = await (await onRequest({request: req('GET', 'tok'), env}, {fetcher, now: 30})).json();
        expect(got).toEqual({athlete_id: 7, name: 'Luke', settings: {ftp: '295'}, updated_at: 20});
        expect((await onRequest({request: req('PUT', 'tok', JSON.stringify({settings: {ftp: 295}})), env}, {fetcher})).status).toBe(400);
        expect((await onRequest({request: req('PUT', 'tok', 'x'.repeat(MAX_BYTES + 1)), env}, {fetcher})).status).toBe(413);
        expect((await onRequest({request: req('DELETE', 'tok'), env}, {fetcher})).status).toBe(200);
        expect(env.DB._riders.size).toBe(0);
        expect(env.DB._tokens.size).toBe(0);
        // a new rider, and their leaving, are in the log
        expect(env.DB._logged.filter(Boolean)).toEqual(['rider:new', 'rider:deleted']);
    });

    test('settings are a flat object of strings', () => {
        expect(validSettings({a: '1'})).toBe(true);
        expect(validSettings({a: 1})).toBe(false);
        expect(validSettings(['a'])).toBe(false);
        expect(validSettings(null)).toBe(false);
    });
});

describe('the browser end', () => {
    const store = (init = {}) => {
        const m = new Map(Object.entries(init));
        return {get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m};
    };
    // the server, in memory, behind a fetch
    const server = (initial = null) => {
        let rec = initial;
        const f = async (url, {method, body}) => {
            if(method === 'GET') return rec ? {status: 200, ok: true, json: async () => rec} : {status: 404, ok: false, json: async () => ({name: 'Luke'})};
            if(method === 'PUT') { rec = {name: 'Luke', settings: JSON.parse(body).settings, updated_at: (rec?.updated_at ?? 100) + 1}; return {status: 200, ok: true, json: async () => ({name: 'Luke', updated_at: rec.updated_at})}; }
            if(method === 'DELETE') { rec = null; return {status: 200, ok: true, json: async () => ({})}; }
        };
        f.rec = () => rec;
        return f;
    };
    const token = async () => 'tok';

    test('what is saved: the rider\'s settings, not this browser\'s', () => {
        expect(synced('ftp')).toBe(true);
        expect(synced('intervals-direct')).toBe(true);
        expect(synced('infergno:strava')).toBe(false);
        expect(synced('ble:remembered')).toBe(false);
        expect(synced('planned')).toBe(false);
        expect(snapshot(store({ftp: '1', 'infergno:strava': 't'}))).toEqual({ftp: '1'});
    });

    test('a rider\'s first connect saves what this browser has', async () => {
        const storage = store({ftp: '295', 'infergno:strava': 'x'});
        const fetcher = server();
        const sync = RiderSync({storage, fetcher, token, reload: () => { throw new Error('no reload'); }, session: store()});
        expect(await sync.pull()).toBe('saved');
        expect(fetcher.rec().settings).toEqual({ftp: '295'});
        expect(await sync.push()).toBe(false);                 // nothing changed since
        storage.setItem('ftp', '300');
        expect(await sync.push()).toBe(true);
        expect(fetcher.rec().settings.ftp).toBe('300');
    });

    test('a new browser takes the saved settings and reloads on them, once', async () => {
        const storage = store({ftp: '200', theme: 'dark'});
        const fetcher = server({name: 'Luke', settings: {ftp: '295', 'intervals-direct': '{"key":"k"}'}, updated_at: 500});
        let reloads = 0;
        const session = store();
        const sync = RiderSync({storage, fetcher, token, reload: () => reloads++, session});
        expect(await sync.pull()).toBe('restored');
        expect(storage.getItem('ftp')).toBe('295');
        expect(storage.getItem('intervals-direct')).toBe('{"key":"k"}');
        expect(reloads).toBe(1);
        // after the reload: up to date, and what only this browser had (theme) is saved too
        expect(await RiderSync({storage, fetcher, token, reload: () => reloads++, session}).pull()).toBe('saved');
        expect(reloads).toBe(1);
        expect(fetcher.rec().settings).toEqual({ftp: '295', 'intervals-direct': '{"key":"k"}', theme: 'dark'});
    });

    test('Disconnect deletes the saved settings', async () => {
        const storage = store({ftp: '295'});
        const fetcher = server({name: 'Luke', settings: {ftp: '295'}, updated_at: 5});
        const sync = RiderSync({storage, fetcher, token, session: store()});
        await sync.forget();
        expect(fetcher.rec()).toBe(null);
        expect(storage.getItem('infergno:sync')).toBe(null);
    });
});

describe('the screen the app opens on', () => {
    test('Home; the ride screen once a ride starts or is restored, not on a resume', () => {
        const pages = [];
        const sp = StartPage((p) => pages.push(p));
        sp.started(); expect(pages).toEqual(['home']);
        sp.started(); expect(pages).toEqual(['home']);            // a resume: stays put
        sp.stopped(); sp.started(); expect(pages).toEqual(['home', 'home']);
        const r = []; const sp2 = StartPage((p) => r.push(p));
        sp2.restored(); sp2.started(); expect(r).toEqual(['home']);
    });
});
