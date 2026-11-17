//
// Rides go to intervals.icu by themselves (rider, Nov 17, 2026: "It should
// be a little more aggressive about uploading to intervals.icu").
//
// Any ride saved in this browser that is not on intervals.icu yet is sent:
// when it ends, when its end screen closes, when the app loads, and again on
// a backing-off timer when intervals.icu does not take it (1, 2, 5, 10, then
// every 20 min). Skipped: rides under 5 minutes (a start and an instant
// stop is not a ride) and rides older than 3 days. The upload's external id
// makes a second one of the same ride a no-op; RPE, feel, notes and the name
// follow the ride there on upload and on every later edit (ride-summary.js).
// Needs the intervals.icu key (Settings > intervals.icu); without it, nothing.
//

import { xf } from './functions.js';
import { models } from './models/models.js';
import direct from './models/intervals-direct.js';

export const MIN_S = 5 * 60;
export const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
export const BACKOFF_S = [60, 120, 300, 600, 1200];
const TICK_MS = 60 * 1000;

// is this ride one to send now?
export function due(s, now = Date.now(), tries = new Map()) {
    if(!s?.id) return false;
    if((s.status?.intervals ?? 'none') === 'success') return false;
    if(!((s.duration ?? 0) >= MIN_S)) return false;
    if(!(now - (s.timestamp ?? 0) <= MAX_AGE_MS)) return false;
    const t = tries.get(s.id);
    return !t || now >= t.next;
}

function AutoUpload(args = {}) {
    const now = args.now ?? (() => Date.now());
    const upload = args.upload ?? ((id) => models.activity.upload('intervals', id, {quiet: true}));
    const configured = args.configured ?? (() => direct.isConfigured());
    let rides = [];
    const tries = new Map();   // id -> {n, next}
    let busy = false;

    async function sweep() {
        if(busy || !configured()) return [];
        busy = true;
        const sent = [];
        try {
            for(const s of rides.filter((r) => due(r, now(), tries))) {
                xf.dispatch('activity:uploading', {id: s.id, service: 'intervals'});
                let res = ':fail';
                try { res = await upload(s.id); } catch(e) { res = ':fail'; }
                sent.push([s.id, res]);
                if(res === ':success') {
                    tries.delete(s.id);
                    s.status = Object.assign({}, s.status, {intervals: 'success'});
                } else {
                    const n = (tries.get(s.id)?.n ?? 0) + 1;
                    tries.set(s.id, {n, next: now() + 1000 * BACKOFF_S[Math.min(n - 1, BACKOFF_S.length - 1)]});
                }
            }
        } finally {
            busy = false;
        }
        return sent;
    }

    function start() {
        xf.sub('db:activity', (list) => { rides = Array.isArray(list) ? list.slice() : []; setTimeout(sweep, 5000); });
        xf.sub('activity:add', (s) => { if(s?.id) { rides = [s, ...rides.filter((r) => r.id !== s.id)]; sweep(); } });
        xf.sub('activity:updated', (s) => { if(s?.id) rides = rides.map((r) => (r.id === s.id ? Object.assign({}, r, s) : r)); });
        xf.sub('activity:deleted', (id) => { rides = rides.filter((r) => r.id !== id); tries.delete(id); });
        xf.sub('ui:ride-summary:closed', () => sweep());
        setInterval(sweep, TICK_MS);
    }

    return Object.freeze({start, sweep, tries, set: (list) => { rides = list.slice(); }});
}

const autoUpload = AutoUpload();
if(typeof window !== 'undefined' && typeof setInterval === 'function' && !globalThis.__AUUKI_NO_AUTOUPLOAD__) {
    autoUpload.start();
}

export default autoUpload;
export { AutoUpload };
