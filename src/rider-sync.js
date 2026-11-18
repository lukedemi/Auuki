//
// A pERGatory rider's settings, saved under their Strava account (rider,
// Nov 18, 2026: "keep a database of every person who logs in with strava all
// their settings, etc - essentially that's their username"). The server end
// is functions/api/rider.js.
//
// Only on the public site, and only once Strava is connected
// (strava-direct.js); the request carries the Strava token it uploads with.
//
//   connecting, or opening the app: the saved settings are fetched; when they
//     are newer than this browser's last sync they replace the ones here and
//     the page reloads on them (a new browser picks up everything this way).
//     A rider with nothing saved yet saves what this browser has.
//   afterwards: a change to the settings here is saved within a minute, and
//     when the page is hidden.
//   Disconnect: the saved settings are deleted (forget()).
//
// The whole set is one record; the last browser to save wins. What is saved:
// every localStorage setting except what belongs to this browser or is
// fetched anyway: the app's own keys (pergatory:*, the Strava tokens among
// them), Bluetooth pairings, the cached planned workouts.
//
import { xf } from './functions.js';
import { flags } from './flavor.js';
import strava from './models/strava-direct.js';

const URL_ = './api/rider';
const SYNC = 'pergatory:sync';
const RELOADED = 'pergatory:sync:reloaded';
const PUSH_MS = 60 * 1000;
export const NOT_SYNCED = [/^pergatory:/, /^ergatory:/, /^ble:/, /^planned$/];
export const synced = (key) => !NOT_SYNCED.some((re) => re.test(key));
const net = (...a) => globalThis.fetch(...a);

export function snapshot(storage = globalThis.localStorage) {
    const out = {};
    for(let i = 0; i < (storage?.length ?? 0); i++) {
        const k = storage.key(i);
        if(k !== null && synced(k)) out[k] = storage.getItem(k);
    }
    return out;
}
// stable: the same settings in any order give the same string
export const fingerprint = (s) => JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k]]));

function readSync(storage) { try { return JSON.parse(storage.getItem(SYNC) ?? 'null') ?? {at: 0, fp: null}; } catch(e) { return {at: 0, fp: null}; } }
function writeSync(storage, v) { try { storage.setItem(SYNC, JSON.stringify(v)); } catch(e) {} }

export function RiderSync({storage = globalThis.localStorage, fetcher = net, token = () => strava.token(), reload = () => location.reload(), session = globalThis.sessionStorage} = {}) {
    let state = {status: 'off', name: null, error: null};
    const set = (s) => { state = {...state, ...s}; xf.dispatch('rider:status', state); };

    async function call(method, body) {
        const access = await token();
        const r = await fetcher(URL_, {method, cache: 'no-store', headers: {authorization: `Bearer ${access}`, ...(body ? {'content-type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
        const out = await r.json().catch(() => ({}));
        return {status: r.status, ok: r.ok, body: out};
    }

    async function push(force = false) {
        const s = snapshot(storage);
        const fp = fingerprint(s);
        const sync = readSync(storage);
        if(!force && fp === sync.fp) return false;
        const res = await call('PUT', {settings: s});
        if(!res.ok) throw new Error(res.body.error ?? `the server answered ${res.status}`);
        writeSync(storage, {at: res.body.updated_at, fp});
        set({status: 'saved', name: res.body.name ?? state.name, error: null, at: res.body.updated_at});
        return true;
    }

    // the server's settings if newer, else this browser's pushed
    async function pull() {
        const res = await call('GET');
        if(res.status === 404) { set({name: res.body.name ?? null}); await push(true); return 'saved'; }
        if(!res.ok) throw new Error(res.body.error ?? `the server answered ${res.status}`);
        set({name: res.body.name ?? null});
        const sync = readSync(storage);
        if(res.body.updated_at > (sync.at ?? 0)) {
            const theirs = res.body.settings ?? {};
            const changed = Object.entries(theirs).filter(([k, v]) => synced(k) && storage.getItem(k) !== v);
            for(const [k, v] of changed) storage.setItem(k, v);
            // what the server holds: anything only this browser had is saved on the next push
            const held = Object.fromEntries(Object.entries(theirs).filter(([k]) => synced(k)));
            writeSync(storage, {at: res.body.updated_at, fp: fingerprint(held)});
            set({status: 'saved', error: null, at: res.body.updated_at});
            // reload once on settings that arrived, so the app starts on them
            if(changed.length && session?.getItem(RELOADED) !== String(res.body.updated_at)) {
                session?.setItem(RELOADED, String(res.body.updated_at));
                xf.dispatch('rider:restored', {settings: changed.length});
                reload();
                return 'restored';
            }
            return 'current';
        }
        await push();
        set({status: 'saved', error: null});
        return 'saved';
    }

    async function safely(fn) {
        try { return await fn(); } catch(e) { set({status: 'error', error: e.message}); return 'error'; }
    }

    async function forget() {
        try { await call('DELETE'); } catch(e) {}
        try { storage.removeItem(SYNC); } catch(e) {}
        set({status: 'off', name: null, error: null});
    }

    function start() {
        if(!flags.strava) return;
        const go = () => { if(strava.isConnected()) safely(pull); };
        xf.sub('strava:connected', go);
        go();
        setInterval(() => { if(strava.isConnected()) safely(() => push()); }, PUSH_MS);
        document.addEventListener('visibilitychange', () => {
            if(document.visibilityState === 'hidden' && strava.isConnected()) safely(() => push());
        });
    }

    return {start, pull: () => safely(pull), push: (f) => safely(() => push(f)), forget, status: () => state};
}

const riderSync = RiderSync();
if(typeof window !== 'undefined' && typeof document !== 'undefined' && !globalThis.__AUUKI_NO_RIDERSYNC__) riderSync.start();

export default riderSync;
