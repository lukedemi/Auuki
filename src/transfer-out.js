//
// /transfer.html on auuki.d3-mi.com and ergatory.d3-mi.com: hands that
// address's settings, rides and workouts to pergatory.d3-mi.com when it asks
// from a frame (transfer.js). Answers pergatory only, and only to a request.
//
import { idb } from './storage/idb.js';
import { collect, TO, REQUEST } from './transfer.js';

window.addEventListener('message', async (e) => {
    if(e.origin !== TO || e.data?.type !== REQUEST) return;
    try {
        await idb.start('store', 4, ['session', 'workouts', 'activity', 'chunks']);
        const data = await collect({storage: localStorage, idb});
        e.source.postMessage(data, TO);
    } catch(err) {
        e.source.postMessage({type: 'pergatory-transfer-error', error: String(err?.message ?? err)}, TO);
    }
});
// ready: pergatory waits for this before asking
if(window.parent !== window) window.parent.postMessage({type: 'pergatory-transfer-ready'}, TO);
