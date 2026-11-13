//
// The trainer room from Home Assistant: temperature, humidity, CO2 and the
// two fans (rider, Nov 13, 2026). Read from ./api/room (functions/api/room.js)
// every 30 s while the page is open and visible; shown over the live chart
// (views/room-status.js), logged once a minute while the timer runs, and the
// log saved with the ride (models.js Activity.chart, `room`).
//
// Nothing here is needed to ride: a page away from home, or HA down, gets
// no strip and no log.
//

import { xf, exists } from './functions.js';

const POLL_MS = 30000;
const LOG_EVERY_S = 60;

function Room(args = {}) {
    let latest = null;
    let log = [];
    let elapsed = 0;
    let running = false;
    let lastLogged = -Infinity;
    let timer = null;

    function row(t, r) {
        return {t, temp: r.temp_f, hum: r.humidity, co2: r.co2,
                front: r.fans?.front?.on ? 1 : 0, rear: r.fans?.rear?.on ? 1 : 0};
    }

    function onReading(r) {
        latest = r;
        xf.dispatch('room:update', r);
        if(running && elapsed - lastLogged >= LOG_EVERY_S) logNow();
    }

    function logNow() {
        if(!latest || !running) return;
        log.push(row(elapsed, latest));
        lastLogged = elapsed;
    }

    function onElapsed(t) {
        if(!exists(t)) return;
        // a new ride: the clock went back
        if(t > 0 && t < elapsed && log.length && t < log[log.length - 1].t) { log = []; lastLogged = -Infinity; }
        if(t > 0) elapsed = t;
        if(running && latest && elapsed - lastLogged >= LOG_EVERY_S) logNow();
    }

    async function poll() {
        if(typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        try {
            const res = await fetch('./api/room', {cache: 'no-store', credentials: 'same-origin'});
            if(!res.ok) return;
            const r = await res.json();
            if(r && !r.error) onReading(r);
        } catch(e) {}
    }

    function start() {
        xf.sub('watch:elapsed', onElapsed);
        xf.sub('watch:started', () => { running = true; if(elapsed - lastLogged >= LOG_EVERY_S) logNow(); });
        xf.sub('watch:paused',  () => { running = false; });
        xf.sub('watch:stopped', () => { logNow(); running = false; });
        poll();
        timer = setInterval(poll, POLL_MS);
        document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') poll(); });
    }

    return Object.freeze({
        start,
        onReading,
        onElapsed,
        latest: () => latest,
        log: () => log.slice(),
        reset: () => { log = []; lastLogged = -Infinity; elapsed = 0; },
        _running: (v) => { running = v; },
    });
}

const room = Room();
if(typeof window !== 'undefined' && typeof document !== 'undefined' && typeof fetch === 'function' && !globalThis.__AUUKI_NO_ROOM__) {
    room.start();
}

// what the ride's log says, for the end screen: first and last, the fans' minutes
export function roomSummary(log = []) {
    const pick = (k) => log.map((r) => r[k]).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const span = (k) => { const v = pick(k); return v.length ? {from: v[0], to: v[v.length - 1], max: Math.max(...v)} : null; };
    if(!log.length) return null;
    const minutes = (k) => {
        let s = 0;
        for(let i = 0; i < log.length; i++) {
            if(!log[i][k]) continue;
            const next = log[i + 1]?.t ?? log[i].t;
            s += Math.max(0, next - log[i].t);
        }
        return Math.round(s / 60);
    };
    return {temp: span('temp'), hum: span('hum'), co2: span('co2'), front: minutes('front'), rear: minutes('rear')};
}

export default room;
export { Room };
