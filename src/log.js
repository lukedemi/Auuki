//
// What people do in infERGno, sent to /api/log (rider, Nov 18, 2026: "I want
// logging built into the whole site so I can see everything anybody is
// doing"). Read at /admin.
//
// Every browser gets an anonymous id (localStorage infergno:visitor); once
// it connects Strava (or signs in to the household) its events carry that
// name too. What is logged: the visit (and where from), each screen and tab,
// the workout picked, rides started, paused, ended and saved, uploads, devices
// connecting, Strava, intervals.icu, the household and group rides, FTP
// changes, the ramp test's result, and every error. Sent in batches every 15
// s and when the page is hidden. The privacy page says so.
//
import { xf } from './functions.js';
import { FLAVOR } from './flavor.js';
import strava from './models/strava-direct.js';
import { householdEmail } from './household.js';

const VISITOR = 'infergno:visitor';
const URL_ = './api/log';
const FLUSH_MS = 15000;
const MAX_ERRORS = 20;

const rand = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
export function visitorId(storage = globalThis.localStorage) {
    try {
        let v = storage.getItem(VISITOR);
        if(!v) { v = rand(); storage.setItem(VISITOR, v); }
        return v;
    } catch(e) { return 'no-storage'; }
}
export const SESSION = rand();

// who this browser is, as far as it knows
export function whoNow() {
    const a = strava.isConnected() ? strava.athlete() : null;
    const name = a ? [a.firstname, a.lastname].filter(Boolean).join(' ') : null;
    if(name || a?.id) return `${name ?? 'Strava rider'}${a?.id ? ` (strava ${a.id})` : ''}`;
    return householdEmail() ?? null;
}

export function Log({send = defaultSend, now = () => Date.now()} = {}) {
    let queue = [], errors = 0;
    function event(kind, data = null) {
        queue.push({t: now(), kind, data, path: typeof location !== 'undefined' ? location.pathname : null});
        if(queue.length >= 40) flush();
    }
    function flush(beacon = false) {
        if(!queue.length) return;
        const batch = {visitor: visitorId(), session: SESSION, who: whoNow(), flavor: FLAVOR, events: queue};
        queue = [];
        send(batch, beacon);
    }
    function error(msg, extra = {}) {
        if(errors++ >= MAX_ERRORS) return;
        event('error', {msg: String(msg).slice(0, 300), ...extra});
    }
    return {event, flush, error, pending: () => queue.length};
}

function defaultSend(batch, beacon) {
    const body = JSON.stringify(batch);
    try {
        if(beacon && navigator.sendBeacon) { navigator.sendBeacon(URL_, new Blob([body], {type: 'application/json'})); return; }
        fetch(URL_, {method: 'POST', headers: {'content-type': 'application/json'}, body, keepalive: true}).catch(() => {});
    } catch(e) {}
}

const PAGES = {workouts: 'home', home: 'ride', settings: 'settings'};

function start(log) {
    const e = log.event;
    e('load', {
        ref: (() => { try { return document.referrer ? new URL(document.referrer).host : null; } catch(_) { return null; } })(),
        screen: globalThis.screen ? `${screen.width}×${screen.height}` : null, lang: globalThis.navigator?.language ?? null,
        app: globalThis.matchMedia?.('(display-mode: standalone)')?.matches ? 'installed' : 'browser',
        query: location.search ? location.search.slice(0, 120) : null,
    });
    let page = null;
    xf.sub('db:page', (p) => { if(p !== page) { page = p; e('page', {page: PAGES[p] ?? p}); } });
    xf.sub('action:nav', (a) => { if(typeof a === 'string' && a.includes(':')) e('tab', {tab: a.split(':')[1]}); });
    let workout = null;
    xf.sub('db:workout', (w) => { const n = w?.meta?.name; if(n && n !== workout) { workout = n; e('workout', {name: n, category: w.meta?.category ?? null}); } });
    xf.sub('home:pick', (p) => e('pick', p));
    let riding = false, elapsed = 0;
    xf.sub('watch:elapsed', (t) => { elapsed = t; });
    xf.sub('watch:started', () => { e(riding ? 'ride:resume' : 'ride:start', {workout}); riding = true; });
    xf.sub('watch:paused', () => e('ride:pause', {elapsed}));
    xf.sub('watch:stopped', () => { if(riding) e('ride:stop', {workout, elapsed}); riding = false; log.flush(); });
    xf.sub('activity:add', (s) => e('ride:saved', {name: s?.name, minutes: Math.round((s?.duration ?? 0) / 60)}));
    const uploads = new Map();
    xf.sub('activity:updated', (s) => {
        for(const [service, status] of Object.entries(s?.status ?? {})) {
            const key = `${s.id}:${service}`;
            if((status === 'success' || status === 'fail') && uploads.get(key) !== status) { uploads.set(key, status); e('upload', {service, status, name: s.name}); }
        }
    });
    for(const id of ['ble:controllable', 'ble:powerMeter', 'ble:heartRateMonitor', 'ble:speedCadenceSensor']) {
        let name = null;
        xf.sub(`${id}:name`, (n) => { if(n && n !== '--') name = n; });
        xf.sub(`${id}:connected`, () => setTimeout(() => e('device:connected', {kind: id.split(':')[1], name}), 500));
        xf.sub(`${id}:disconnected`, () => e('device:disconnected', {kind: id.split(':')[1], name}));
    }
    xf.sub('strava:connected', (r) => e('strava:connected', {athlete: r?.athlete?.id ?? null}));
    xf.sub('strava:disconnected', () => e('strava:disconnected'));
    xf.sub('services', (s) => { if('intervals' in (s ?? {})) e(s.intervals ? 'intervals:connected' : 'intervals:disconnected'); });
    xf.sub('household:status', (s) => { if(s?.household) e('household', {email: s.email ?? null}); });
    xf.sub('rider:restored', (r) => e('settings:restored', r));
    xf.sub('ramp-test:result', (r) => e('ramp-test:result', r));
    xf.sub('ui:ftp-set', (f) => e('ftp:set', {ftp: f}));
    xf.sub('group:created', (g) => e('group:created', g));
    xf.sub('group:mode', (on) => e(on ? 'group:joined' : 'group:left'));
    window.addEventListener('error', (ev) => log.error(ev.message, {src: ev.filename?.split('/').pop(), line: ev.lineno}));
    window.addEventListener('unhandledrejection', (ev) => log.error(ev.reason?.message ?? ev.reason));
    const loadedAt = Date.now();
    document.addEventListener('visibilitychange', () => {
        if(document.visibilityState === 'hidden') { e('hidden', {after_s: Math.round((Date.now() - loadedAt) / 1000)}); log.flush(true); }
    });
    window.addEventListener('pagehide', () => log.flush(true));
    setInterval(() => log.flush(), FLUSH_MS);
}

const log = Log();
if(typeof window !== 'undefined' && typeof document !== 'undefined' && !globalThis.__AUUKI_NO_LOG__) {
    try { start(log); } catch(e) {}
}

export default log;
