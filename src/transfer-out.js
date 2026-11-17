//
// auuki.d3-mi.com/transfer.html: hands this site's settings, rides and
// workouts to ergatory.d3-mi.com when it asks from a frame (transfer.js).
// Answers ergatory only, and only to a request.
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
        e.source.postMessage({type: 'ergatory-transfer-error', error: String(err?.message ?? err)}, TO);
    }
});
// ready: ergatory waits for this before asking
if(window.parent !== window) window.parent.postMessage({type: 'ergatory-transfer-ready'}, TO);
