//
// Debug traces, sent home (this fork, Nov 13, 2026; rider: "being able to
// send debug traces back somewhere so we can debug what's happening live").
//
// Every page load is a session. Rows, batched to /api/trace every 10 s
// (functions/api/trace.js, D1 `auuki`), read with scripts/traces.mjs:
//
//   state  once a second while the timer runs, every 5 s otherwise: power,
//          heart rate, cadence, the workout target, what the trainer was
//          sent, the power-match ratio, mode, watch status, elapsed
//   event  devices connecting, dropping and reconnecting, the watch
//          starting, pausing and stopping, mode changes, power-match
//          corrections, the ride being saved and restored, uploads
//   log / warn / error   the console, and uncaught errors with their stack
//   mark   window.trace.mark('…'), or the debug panel's mark button
//
// Settings > Send Debug Traces turns it off. Nothing is kept if the post
// fails beyond the last 3000 rows.
//

import { xf, exists } from './functions.js';
import { uuid } from './storage/uuid.js';

const FLUSH_MS  = 10000;
const MAX_BUF   = 3000;
const LOG_CAP   = 40;        // console rows per second, beyond which they are counted, not kept
const ENDPOINT  = './api/trace';

const BLE = ['controllable', 'powerMeter', 'heartRateMonitor', 'speedCadenceSensor', 'smo2', 'coreTemp', 'openBikeControl'];

function Trace(args = {}) {
    const session = (args.session ?? uuid()).replace(/[^A-Za-z0-9_{}-]/g, '');
    const started = Date.now();
    const now = args.now ?? (() => Date.now());
    let enabled = true;
    let buf = [];
    let version = '';
    let failures = 0;
    let timer;
    let logWindow = {at: 0, n: 0, dropped: 0};

    const st = {power: 0, hr: 0, cad: 0, target: 0, sent: null, ratio: null, mode: null, status: 'stopped', elapsed: 0, intensity: 100, bal: null};

    function push(kind, data) {
        if(!enabled) return;
        buf.push({ts: now(), kind, data});
        if(buf.length > MAX_BUF) buf.splice(0, buf.length - MAX_BUF);
    }

    function event(name, data = {}) { push('event', {name, ...data}); }
    function mark(text = '') { push('mark', {text: String(text)}); flush(); }

    function state() {
        push('state', {...st});
    }

    // ---------------------------------------------------------------- console

    function text(args) {
        return args.map((a) => {
            if(typeof a === 'string') return a;
            if(a instanceof Error) return `${a.name}: ${a.message}`;
            try { return JSON.stringify(a); } catch(e) { return String(a); }
        }).join(' ').slice(0, 2000);
    }

    function wrapConsole() {
        for(const [method, kind] of [['log', 'log'], ['info', 'log'], ['warn', 'warn'], ['error', 'error']]) {
            const original = console[method]?.bind(console);
            if(!original) continue;
            console[method] = (...a) => {
                original(...a);
                try {
                    const line = text(a);
                    // IndexedDB chatter is one line per write
                    if(kind === 'log' && /^:idb /.test(line)) return;
                    const sec = Math.floor(now() / 1000);
                    if(logWindow.at !== sec) {
                        if(logWindow.dropped) push('warn', {text: `trace: ${logWindow.dropped} console lines dropped in one second`});
                        logWindow = {at: sec, n: 0, dropped: 0};
                    }
                    if(++logWindow.n > LOG_CAP) { logWindow.dropped++; return; }
                    push(kind, {text: line});
                } catch(e) {}
            };
        }
        window.addEventListener('error', (e) => push('error', {
            text: e.message, source: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack?.slice(0, 3000),
        }));
        window.addEventListener('unhandledrejection', (e) => push('error', {
            text: `unhandled rejection: ${e.reason?.message ?? String(e.reason)}`, stack: e.reason?.stack?.slice(0, 3000),
        }));
    }

    // ---------------------------------------------------------------- the app

    function subscribe() {
        xf.sub('db:sources', (s) => {
            const next = (s ?? {}).traces ?? true;
            if(next !== enabled) { enabled = true; event('traces', {on: next}); flush(); }
            enabled = next;
        });

        xf.sub('db:power1s',     (v) => st.power = v);
        xf.sub('db:heartRate',   (v) => st.hr = v);
        xf.sub('db:cadence',     (v) => st.cad = v);
        xf.sub('db:balance',     (v) => st.bal = v);
        xf.sub('db:powerTarget', (v) => st.target = v);
        xf.sub('trainer:powerTarget', (v) => st.sent = v);
        xf.sub('powerMatch:status', (s) => st.ratio = s?.active ? Math.round(s.ratio * 10000) / 10000 : null);
        xf.sub('db:mode', (m) => { if(m !== st.mode) event('mode', {mode: m}); st.mode = m; });
        xf.sub('watch:elapsed', (t) => { st.elapsed = t; if(st.status === 'started' && t > 0) state(); });

        for(const s of ['started', 'paused', 'stopped']) {
            xf.sub(`watch:${s}`, () => { st.status = s; event(`watch:${s}`, {elapsed: st.elapsed}); });
        }
        for(const id of BLE) {
            const key = `ble:${id}`;
            for(const what of ['connecting', 'connected', 'disconnected']) {
                xf.sub(`${key}:${what}`, () => event(`${key}:${what}`));
            }
            xf.sub(`${key}:name`, (name) => { if(name && name !== '--') event(`${key}:name`, {device: name}); });
        }
        xf.sub('ble:reconnect', (r) => event('ble:reconnect', r));
        xf.sub('db:intensity', (v) => { if(v !== st.intensity) event('intensity', {from: st.intensity, to: v}); st.intensity = v; });
        xf.sub('sound:beep', (r) => event('beep', r));
        xf.sub('interval:extended', (r) => event('interval:extended', r));
        xf.sub('powerMatch:debug', (r) => {
            if(r && r.event) event('powerMatch', {what: r.event, target: r.target, sent: r.sent, ratio: r.ratio,
                trainer: r.trainer, meter: r.meter, steady: r.steady, calm: r.calm});
        });
        xf.sub('session:restored', (r) => event('session:restored', r));
        xf.sub('session:backup:error', (e) => event('session:backup:error', {error: e}));
        let backups = 0;
        xf.sub('session:backup', (r) => { if(++backups % 4 === 1) event('session:backup', r); });
        xf.sub('activity:save:success', () => event('activity:saved'));
        xf.sub('activity:save:fail', () => event('activity:save:fail'));
    }

    // ---------------------------------------------------------------- sending

    function payload(rows) {
        return JSON.stringify({session, meta: {ua: navigator.userAgent, version, started}, rows});
    }

    async function flush() {
        if(!buf.length) return;
        const rows = buf;
        buf = [];
        try {
            const r = await fetch(ENDPOINT, {method: 'POST', headers: {'content-type': 'application/json'},
                body: payload(rows), keepalive: rows.length < 200, credentials: 'same-origin'});
            if(!r.ok) throw new Error(`HTTP ${r.status}`);
            failures = 0;
        } catch(e) {
            failures++;
            buf = rows.concat(buf);
            if(buf.length > MAX_BUF) buf.splice(0, buf.length - MAX_BUF);
        }
    }

    // a closing tab gets one last try
    function beacon() {
        if(!buf.length || !navigator.sendBeacon) return;
        const rows = buf.slice(-500);
        if(navigator.sendBeacon(ENDPOINT, new Blob([payload(rows)], {type: 'application/json'}))) buf = [];
    }

    function start() {
        wrapConsole();
        subscribe();
        fetch('./version.json', {cache: 'no-store'}).then((r) => r.ok ? r.json() : {}).then((v) => {
            version = [v.sha, v.built].filter(Boolean).join(' ');
        }).catch(() => {});
        event('page:load', {url: location.pathname + location.search, bluetooth: 'bluetooth' in navigator,
            getDevices: typeof navigator.bluetooth?.getDevices === 'function',
            watchAdvertisements: typeof globalThis.BluetoothDevice?.prototype?.watchAdvertisements === 'function'});
        timer = setInterval(() => {
            // every 5 s of state when the timer is not running
            if(st.status !== 'started' && Math.floor(now() / 1000) % 5 === 0) state();
        }, 1000);
        setInterval(() => { if(!failures || failures % 6 === 0 || buf.length > 500) flush(); else failures++; }, FLUSH_MS);
        document.addEventListener('visibilitychange', () => {
            if(document.visibilityState === 'hidden') { event('page:hidden'); beacon(); }
            else event('page:visible');
        });
        window.addEventListener('pagehide', () => { event('page:hide'); beacon(); });
    }

    return Object.freeze({start, flush, mark, event, session, buffer: () => buf, payload});
}

const trace = Trace();
if(typeof window !== 'undefined' && typeof document !== 'undefined' && typeof fetch === 'function' && !globalThis.__AUUKI_NO_TRACE__) {
    trace.start();
    window.trace = trace;
}

export default trace;
export { Trace };
