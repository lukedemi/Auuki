//
// On ergatory.d3-mi.com, once the household is signed in: bring the rider's
// settings, rides and workouts over from auuki.d3-mi.com (transfer.js), the
// first time by itself, later from Settings > Household. Then reload, so the
// app starts on them.
//
import { idb } from './storage/idb.js';
import { FROM, TO, REQUEST, ANSWER, apply } from './transfer.js';
import { FLAVOR } from './flavor.js';
import { whenHousehold } from './household.js';

const DONE = 'ergatory:transfer';
const WAIT_MS = 20000;

export function lastTransfer() {
    try { return JSON.parse(localStorage.getItem(DONE) ?? 'null'); } catch(e) { return null; }
}

export function pull({waitMs = WAIT_MS} = {}) {
    return new Promise((resolve, reject) => {
        const frame = document.createElement('iframe');
        frame.src = `${FROM}/transfer.html`;
        frame.style.display = 'none';
        frame.setAttribute('aria-hidden', 'true');
        const timer = setTimeout(() => finish(new Error(`${FROM} did not answer: open it once in this browser, signed in, then try again`)), waitMs);
        function finish(err, data) {
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            frame.remove();
            err ? reject(err) : resolve(data);
        }
        function onMessage(e) {
            if(e.origin !== FROM) return;
            if(e.data?.type === 'ergatory-transfer-ready') frame.contentWindow.postMessage({type: REQUEST}, FROM);
            else if(e.data?.type === ANSWER) finish(null, e.data);
            else if(e.data?.type === 'ergatory-transfer-error') finish(new Error(e.data.error));
        }
        window.addEventListener('message', onMessage);
        document.body.appendChild(frame);
    });
}

export async function transfer() {
    const data = await pull();
    await idb.start('store', 4, ['session', 'workouts', 'activity', 'chunks']);
    const res = await apply(data, {storage: localStorage, idb});
    const record = {at: Date.now(), ...res};
    try { localStorage.setItem(DONE, JSON.stringify(record)); } catch(e) {}
    return record;
}

// the first sign-in on ergatory brings everything over by itself
export function auto() {
    if(FLAVOR !== 'public' || typeof location === 'undefined' || location.origin !== TO) return;
    whenHousehold(async () => {
        if(lastTransfer()) return;
        try {
            const res = await transfer();
            if(res.settings || res.rides || res.workouts) {
                sessionStorage.setItem('ergatory:transfer:notice', JSON.stringify(res));
                location.reload();
            }
        } catch(e) {
            try { localStorage.setItem(DONE, JSON.stringify({at: Date.now(), error: e.message})); } catch(_) {}
            console.warn('transfer from auuki.d3-mi.com:', e.message);
        }
    });
}
