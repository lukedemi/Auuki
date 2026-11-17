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
// Strava the same way once the rider has connected it (Settings > Strava,
// strava-direct.js), for rides finished after connecting: connecting must not
// send the last three days at once, some of them perhaps already uploaded by
// hand.
//

import { xf } from './functions.js';
import { models } from './models/models.js';
import direct from './models/intervals-direct.js';
import stravaDirect from './models/strava-direct.js';

export const MIN_S = 5 * 60;
export const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
export const BACKOFF_S = [60, 120, 300, 600, 1200];
const TICK_MS = 60 * 1000;

// is this ride one to send to this service now?
export function due(s, now = Date.now(), tries = new Map(), service = 'intervals', since = 0) {
    if(!s?.id) return false;
    if((s.status?.[service] ?? 'none') === 'success') return false;
    if(!((s.duration ?? 0) >= MIN_S)) return false;
    if(!(now - (s.timestamp ?? 0) <= MAX_AGE_MS)) return false;
    if(since && (s.timestamp ?? 0) < since) return false;
    const t = tries.get(`${service}:${s.id}`) ?? tries.get(s.id);
    return !t || now >= t.next;
}

export const SERVICES = [
    {name: 'intervals', configured: () => direct.isConfigured(), since: () => 0},
    {name: 'strava',    configured: () => stravaDirect.isConnected(), since: () => stravaDirect.connectedAt()},
];

function AutoUpload(args = {}) {
    const now = args.now ?? (() => Date.now());
    // tests hand in one service as {configured, upload}: intervals.icu
    const services = args.services
        ?? (args.upload ? [{name: 'intervals', configured: args.configured ?? (() => true), upload: args.upload, since: () => 0}] : null)
        ?? SERVICES.map((sv) => Object.assign({}, sv, {upload: (id) => models.activity.upload(sv.name, id, {quiet: true})}));
    let rides = [];
    const tries = new Map();   // `${service}:${id}` -> {n, next}
    let busy = false;

    async function sweep() {
        if(busy) return [];
        busy = true;
        const sent = [];
        try {
            for(const sv of services) {
                if(!sv.configured()) continue;
                for(const s of rides.filter((r) => due(r, now(), tries, sv.name, sv.since?.() ?? 0))) {
                    const key = `${sv.name}:${s.id}`;
                    xf.dispatch('activity:uploading', {id: s.id, service: sv.name});
                    let res = ':fail';
                    try { res = await sv.upload(s.id); } catch(e) { res = ':fail'; }
                    sent.push(sv.name === 'intervals' ? [s.id, res] : [s.id, res, sv.name]);
                    if(res === ':success') {
                        tries.delete(key);
                        s.status = Object.assign({}, s.status, {[sv.name]: 'success'});
                    } else {
                        const n = (tries.get(key)?.n ?? 0) + 1;
                        tries.set(key, {n, next: now() + 1000 * BACKOFF_S[Math.min(n - 1, BACKOFF_S.length - 1)]});
                    }
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
        xf.sub('activity:deleted', (id) => { rides = rides.filter((r) => r.id !== id); for(const k of [...tries.keys()]) if(k.endsWith(`:${id}`)) tries.delete(k); });
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
