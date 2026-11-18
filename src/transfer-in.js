//
// On pergatory.d3-mi.com: bring the rider's settings, rides and workouts over
// from the addresses this app lived at before (transfer.js), each once and by
// itself: ergatory.d3-mi.com for anyone, auuki.d3-mi.com once signed in to
// the household (again from Settings > Household). Then reload, so the app
// starts on them.
//
import { idb } from './storage/idb.js';
import { SOURCES, TO, REQUEST, ANSWER, apply } from './transfer.js';
import { FLAVOR } from './flavor.js';
import { whenHousehold } from './household.js';

const DONE = (name) => `pergatory:transfer:${name}`;
export const NOTICE = 'pergatory:transfer:notice';
const WAIT_MS = 20000;

export function lastTransfer(name = 'auuki') {
    try { return JSON.parse(localStorage.getItem(DONE(name)) ?? 'null'); } catch(e) { return null; }
}

export function pull(from, {waitMs = WAIT_MS} = {}) {
    return new Promise((resolve, reject) => {
        const frame = document.createElement('iframe');
        frame.src = `${from}/transfer.html`;
        frame.style.display = 'none';
        frame.setAttribute('aria-hidden', 'true');
        const timer = setTimeout(() => finish(new Error(`${from} did not answer: open it once in this browser, signed in, then try again`)), waitMs);
        function finish(err, data) {
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            frame.remove();
            err ? reject(err) : resolve(data);
        }
        function onMessage(e) {
            if(e.origin !== from) return;
            if(e.data?.type === 'pergatory-transfer-ready') frame.contentWindow.postMessage({type: REQUEST}, from);
            else if(e.data?.type === ANSWER) finish(null, e.data);
            else if(e.data?.type === 'pergatory-transfer-error') finish(new Error(e.data.error));
        }
        window.addEventListener('message', onMessage);
        document.body.appendChild(frame);
    });
}

export async function transfer(name = 'auuki') {
    const from = SOURCES[name].origin;
    const data = await pull(from);
    await idb.start('store', 4, ['session', 'workouts', 'activity', 'chunks']);
    const res = await apply(data, {storage: localStorage, idb});
    const record = {at: Date.now(), from: from.replace('https://', ''), ...res};
    try { localStorage.setItem(DONE(name), JSON.stringify(record)); } catch(e) {}
    return record;
}

async function once(name) {
    if(lastTransfer(name)) return;
    try {
        const res = await transfer(name);
        if(res.settings || res.rides || res.workouts) {
            sessionStorage.setItem(NOTICE, JSON.stringify(res));
            location.reload();
        }
    } catch(e) {
        try { localStorage.setItem(DONE(name), JSON.stringify({at: Date.now(), error: e.message})); } catch(_) {}
        console.warn(`transfer from ${SOURCES[name].origin}:`, e.message);
    }
}

// ergatory first, for anyone; then auuki, for the household
export function auto() {
    if(FLAVOR !== 'public' || typeof location === 'undefined' || location.origin !== TO) return;
    const first = once('ergatory');
    whenHousehold(() => first.then(() => once('auuki')));
}
