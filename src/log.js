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
// And, for the Strava launch (rider, Nov 26, 2026: "I'll just want to see if
// they click around, exactly what they do on the site"): every click on
// something clickable, by its label (`clickLabel`: never a value typed into a
// field), the workout searches, how far down each screen they scrolled, and
// at the visit whether this browser can ride at all (Web Bluetooth: iOS
// cannot) and whether it is Strava's in-app browser.
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

// what a click was on, in words: the clickable thing's own label, never what
// was typed into a field. null for a click on nothing clickable.
const CLICKABLE = 'button, a, [role="button"], [data-act], [data-id], navigation-action, page-btn, tab-btn, connection-switch, .lc--win, .menu--btn, .control--btn, summary, label';
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
export function clickLabel(target) {
    const el = target?.closest?.(CLICKABLE);
    if(!el || el.matches('input, textarea, select')) return null;
    const card = el.matches('[data-id]') ? clean(el.querySelector('h1, h2, h3, h4, .name, [class*="name"], [class*="title"]')?.textContent) : '';
    const text = clean(el.getAttribute('aria-label')) || card || clean(el.textContent) || clean(el.getAttribute('title'));
    const name = (text || el.id || el.dataset?.act || el.tagName.toLowerCase()).slice(0, 80);
    const tag = el.id ? `#${el.id}` : el.dataset?.act ? `[${el.dataset.act}]` : el.tagName.toLowerCase();
    return {el: name, tag, href: el.tagName === 'A' ? (el.getAttribute('href') || '').slice(0, 120) : undefined};
}

// the browser, in the words that matter for this app
export function browserOf(nav = globalThis.navigator) {
    const ua = nav?.userAgent ?? '';
    return {
        bluetooth: !!(nav && 'bluetooth' in nav),
        mobile: /Mobi|iPhone|iPad|Android/i.test(ua),
        inApp: /Strava/i.test(ua) ? 'strava' : /FBAN|FBAV|Instagram|Line\/|wv\)/.test(ua) ? 'other' : null,
    };
}

function start(log) {
    const e = log.event;
    e('load', {
        ref: (() => { try { return document.referrer ? new URL(document.referrer).host : null; } catch(_) { return null; } })(),
        screen: globalThis.screen ? `${screen.width}×${screen.height}` : null, lang: globalThis.navigator?.language ?? null,
        app: globalThis.matchMedia?.('(display-mode: standalone)')?.matches ? 'installed' : 'browser',
        query: location.search ? location.search.slice(0, 120) : null,
        window: globalThis.innerWidth ? `${innerWidth}×${innerHeight}` : null,
        ...browserOf(),
    });
    // the app opens on Home (the page set before this subscribed is not sent again)
    let page = 'workouts';
    // how far down each screen they got, said when they leave it
    let deepest = 0;
    const depth = () => { if(deepest > 0) { e('scroll', {page: PAGES[page] ?? page, pct: Math.round(deepest * 100)}); deepest = 0; } };
    document.addEventListener('scroll', (ev) => {
        const el = ev.target === document ? document.scrollingElement : ev.target;
        if(!el || !(el.scrollHeight > el.clientHeight + 40)) return;
        deepest = Math.max(deepest, Math.min(1, (el.scrollTop + el.clientHeight) / el.scrollHeight));
    }, {capture: true, passive: true});
    xf.sub('db:page', (p) => { if(p !== page) { depth(); page = p; e('page', {page: PAGES[p] ?? p}); } });
    // every click on something clickable
    let lastClick = {el: null, t: 0};
    // the screen the click was made on: a nav button changes it on pointerup,
    // before the click arrives
    let pageAtDown = page;
    document.addEventListener('pointerdown', () => { pageAtDown = page; }, {capture: true, passive: true});
    document.addEventListener('click', (ev) => {
        const c = clickLabel(ev.target);
        if(!c) return;
        const now = Date.now();
        if(c.el === lastClick.el && now - lastClick.t < 400) return;
        lastClick = {el: c.el, t: now};
        e('click', {...c, page: PAGES[pageAtDown] ?? pageAtDown});
    }, {capture: true});
    // the workout search, once they pause typing
    let typing = null;
    document.addEventListener('input', (ev) => {
        if(!ev.target?.matches?.('input[type="search"]')) return;
        clearTimeout(typing);
        const q = clean(ev.target.value).slice(0, 60);
        if(q.length >= 2) typing = setTimeout(() => e('search', {q}), 1200);
    }, {capture: true});
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
    xf.sub('watch:done-prompt', (on) => { if(on) e('workout:done', {workout, elapsed}); });
    xf.sub('stopwatch:lap', (l) => e('stopwatch', {n: l?.n, last: l?.last ?? null}));
    xf.sub('ui:keep-riding', () => e('workout:keep-riding', {workout}));
    let rescuing = false;
    xf.sub('powerMatch:rescue', (r) => {
        if(r?.on && !rescuing) e('spiral:rescue', {cadence: Math.round(r.cadence ?? 0), target: Math.round(r.target ?? 0), workout});
        if(!r?.on && rescuing) e('spiral:recovered');
        rescuing = !!r?.on;
    });
    xf.sub('group:created', (g) => e('group:created', g));
    xf.sub('group:mode', (on) => e(on ? 'group:joined' : 'group:left'));
    window.addEventListener('error', (ev) => log.error(ev.message, {src: ev.filename?.split('/').pop(), line: ev.lineno}));
    window.addEventListener('unhandledrejection', (ev) => log.error(ev.reason?.message ?? ev.reason));
    const loadedAt = Date.now();
    document.addEventListener('visibilitychange', () => {
        if(document.visibilityState === 'hidden') { depth(); e('hidden', {after_s: Math.round((Date.now() - loadedAt) / 1000)}); log.flush(true); }
    });
    window.addEventListener('pagehide', () => log.flush(true));
    setInterval(() => log.flush(), FLUSH_MS);
}

const log = Log();
if(typeof window !== 'undefined' && typeof document !== 'undefined' && !globalThis.__AUUKI_NO_LOG__) {
    try { start(log); } catch(e) {}
}

export default log;
