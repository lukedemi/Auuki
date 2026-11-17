//
// Is this the household? (rider, Nov 17, 2026: "how can I run my rides
// through ergatory.d3-mi.com too? like how can it know it's me and have all
// my fancy flags without us running a separate website")
//
// The household build (auuki.d3-mi.com, all of it behind Cloudflare Access)
// always is. The public build asks /api/me, one of the few paths on
// ergatory.d3-mi.com that Cloudflare Access keeps for the household group
// (with /api/room, /api/trace, /api/host and /household). Signed in there —
// Settings > Household sign-in, which goes through /household once and lasts
// a month — it answers with the email; for anyone else Access answers with a
// login redirect, which reads here as "not household", silently.
//
// The answer is remembered in this browser so a household load starts its
// extras (the room, the traces) at once; it is re-checked on every load, and
// a "no" switches them off from the next load.
//

import { xf } from './functions.js';
import { FLAVOR } from './flavor.js';

const KEY = 'ergatory:household';

function storage() { try { return globalThis.localStorage; } catch(e) { return undefined; } }

function cached() {
    try { return JSON.parse(storage()?.getItem(KEY) ?? 'null'); } catch(e) { return null; }
}

let state = FLAVOR === 'home' ? {household: true, email: null, at: 0} : (cached() ?? {household: false});

export function isHousehold() { return !!state?.household; }
export function householdEmail() { return state?.email ?? null; }

function mark() {
    if(typeof document === 'undefined') return;
    if(state.household) document.documentElement.dataset.household = '1';
    else delete document.documentElement.dataset.household;
}

// the answer from /api/me: household only on a 200 with JSON saying so
export async function check(fetcher = (...a) => globalThis.fetch(...a)) {
    if(FLAVOR === 'home') return state;
    let next = {household: false};
    try {
        const r = await fetcher('./api/me', {cache: 'no-store', credentials: 'same-origin', redirect: 'manual'});
        if(r.ok && (r.headers.get?.('content-type') ?? '').includes('json')) {
            const body = await r.json();
            if(body?.household) next = {household: true, email: body.email ?? null, at: Date.now()};
        }
    } catch(e) {
        // offline or blocked: keep what this browser knew
        return state;
    }
    const changed = next.household !== state.household;
    state = next;
    try { next.household ? storage()?.setItem(KEY, JSON.stringify(next)) : storage()?.removeItem(KEY); } catch(e) {}
    mark();
    if(changed || next.household) xf.dispatch('household:status', state);
    return state;
}

export function start() {
    mark();
    if(state.household) xf.dispatch('household:status', state);
    // back from Settings > Household sign-in (/household -> /?household=1)
    let signedIn = false;
    try {
        if(new URLSearchParams(location.search).get('household') === '1') {
            signedIn = true;
            history.replaceState({}, document.title, location.pathname);
        }
    } catch(e) {}
    if(FLAVOR !== 'home' && typeof fetch === 'function') {
        check().then(() => { if(signedIn) setTimeout(() => xf.dispatch('ui:page-set', 'settings'), 800); });
    }
}

// once the household is known (now, or after /api/me answers)
export function whenHousehold(fn) {
    if(isHousehold()) { fn(state); return; }
    let done = false;
    xf.sub('household:status', (s) => { if(s?.household && !done) { done = true; fn(s); } });
}

export default {isHousehold, householdEmail, check, start, whenHousehold};
