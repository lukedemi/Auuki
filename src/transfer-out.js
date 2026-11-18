//
// /transfer on auuki.d3-mi.com and the old public addresses: hands that
// address's settings, rides and workouts to infergno.com when it asks, from
// the popup infERGno opened (transfer.js), then closes. Answers infergno.com
// only, and only to a request.
//
import { idb } from './storage/idb.js';
import { collect, TO, REQUEST } from './transfer.js';

const asker = window.opener ?? (window.parent !== window ? window.parent : null);
const say = (text) => { const p = document.querySelector('p'); if(p) p.textContent = text; };

window.addEventListener('message', async (e) => {
    if(e.origin !== TO || e.data?.type !== REQUEST) return;
    try {
        say('Sending your settings and rides to infergno.com…');
        await idb.start('store', 4, ['session', 'workouts', 'activity', 'chunks']);
        const data = await collect({storage: localStorage, idb});
        e.source.postMessage(data, TO);
        say('Done. This window closes by itself.');
        if(window.opener) setTimeout(() => window.close(), 400);
    } catch(err) {
        e.source.postMessage({type: 'infergno-transfer-error', error: String(err?.message ?? err)}, TO);
    }
});
// ready: infERGno waits for this before asking
if(asker) asker.postMessage({type: 'infergno-transfer-ready'}, TO);
