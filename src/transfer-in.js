//
// On infergno.com: bring the rider's settings, rides and workouts over from
// an address this app lived at before (transfer.js): ergatory.d3-mi.com or
// pergatory.d3-mi.com for anyone, auuki.d3-mi.com for the household. On a
// click (views/move-in.js, Settings > Household), because it opens the old
// address in a small popup window. Then reload, so the app starts on them.
//
import { idb } from './storage/idb.js';
import { SOURCES, TO, REQUEST, ANSWER, apply } from './transfer.js';

const DONE = (name) => `infergno:transfer:${name}`;
export const NOTICE = 'infergno:transfer:notice';
const WAIT_MS = 120000;     // long enough to sign in to Access in the popup

export function lastTransfer(name = 'auuki') {
    try { return JSON.parse(localStorage.getItem(DONE(name)) ?? 'null'); } catch(e) { return null; }
}

// must run inside a click: browsers block a popup opened any other way
export function pull(from, {waitMs = WAIT_MS} = {}) {
    return new Promise((resolve, reject) => {
        const w = window.open(`${from}/transfer`, 'infergno-transfer', 'popup,width=460,height=420');
        if(!w) { reject(new Error('the browser blocked the window that brings them over; allow pop-ups for infergno.com and press again')); return; }
        const timer = setTimeout(() => finish(new Error(`${from.replace('https://', '')} did not answer`)), waitMs);
        const closed = setInterval(() => { if(w.closed) finish(new Error('the window was closed before it finished')); }, 500);
        let done = false;
        function finish(err, data) {
            if(done) return;
            done = true;
            clearTimeout(timer);
            clearInterval(closed);
            window.removeEventListener('message', onMessage);
            try { if(!w.closed) w.close(); } catch(e) {}
            err ? reject(err) : resolve(data);
        }
        function onMessage(e) {
            if(e.origin !== from || e.source !== w) return;
            if(e.data?.type === 'infergno-transfer-ready') w.postMessage({type: REQUEST}, from);
            else if(e.data?.type === ANSWER) finish(null, e.data);
            else if(e.data?.type === 'infergno-transfer-error') finish(new Error(e.data.error));
        }
        window.addEventListener('message', onMessage);
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

// bring one over and reload on it, from a click
export async function transferAndReload(name) {
    const res = await transfer(name);
    try { sessionStorage.setItem(NOTICE, JSON.stringify(res)); } catch(e) {}
    location.reload();
    return res;
}

// which old address sent this browser here (the redirect adds ?moved=)
export const MOVED_KEY = 'infergno:moved-from';
export function noteMovedFrom(search = location.search) {
    const p = new URLSearchParams(search);
    const name = p.get('moved');
    if(!name || !SOURCES[name]) return null;
    try { localStorage.setItem(MOVED_KEY, name); } catch(e) {}
    p.delete('moved');
    const q = p.toString();
    try { history.replaceState({}, document.title, location.pathname + (q ? `?${q}` : '') + location.hash); } catch(e) {}
    return name;
}
export function movedFrom() {
    try { return localStorage.getItem(MOVED_KEY); } catch(e) { return null; }
}
