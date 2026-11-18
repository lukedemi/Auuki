//
// Bringing a rider's things to infergno.com from the addresses this
// app lived at before: auuki.d3-mi.com, the household's (rider, Nov 17, 2026:
// "transfer as many settings to me as you can without me having to do it"),
// and the public ones before infergno.com: ergatory.d3-mi.com (ERGatory) and
// pergatory.d3-mi.com (pERGatory).
//
// A browser keeps each address's data apart. infERGno opens the old address's
// /transfer page in a small popup window (transfer-in.js), on a click: a
// popup is a top-level window, so it sees that address's own storage and,
// for auuki, its Access sign-in, which a frame inside infergno.com would not
// (a different site: Chrome partitions a cross-site frame's storage and
// withholds its cookies). The page answers one request, from infergno.com
// only, with what this browser holds there: every localStorage setting and
// the saved rides and workouts, then closes. infERGno stores them and
// reloads. The old public addresses redirect every page here except that
// one (functions/_middleware.js), so it can still answer.
//
// Not moved: Bluetooth pairings (Chrome grants those per site; pair once),
// the ride in progress, and what belongs to an address rather than the
// rider (its household sign-in, its transfer records, a Strava connect
// half-done). The Strava connection itself does move: its tokens are the
// rider's, not the address's.
//

export const TO = 'https://infergno.com';
export const SOURCES = Object.freeze({
    // the old public addresses: anyone who used them, on their first visit
    // here, oldest first so the newer settings win
    ergatory:  {origin: 'https://ergatory.d3-mi.com', household: false},
    pergatory: {origin: 'https://pergatory.d3-mi.com', household: false},
    // the household's own copy: once signed in to the household here
    auuki:    {origin: 'https://auuki.d3-mi.com', household: true},
});
export const FROM = SOURCES.auuki.origin;
export const REQUEST = 'infergno-transfer-request';
export const ANSWER = 'infergno-transfer';

// the app's own keys from the old addresses under the new name
export const renamed = (key) => key.replace(/^(ergatory|pergatory):/, 'infergno:');
// settings that belong to the address, not the rider: never carried over
export const KEEP_LOCAL = [/^infergno:household$/, /^infergno:transfer/, /^infergno:strava:state$/, /^ble:remembered$/];
export const carried = (key) => !KEEP_LOCAL.some((re) => re.test(renamed(key)));

// what the old address sends: its settings and its saved rides and workouts
export async function collect({storage = globalThis.localStorage, idb} = {}) {
    const settings = {};
    for(let i = 0; i < (storage?.length ?? 0); i++) {
        const k = storage.key(i);
        if(k !== null && carried(k)) settings[k] = storage.getItem(k);
    }
    let activity = [], workouts = [];
    if(idb) {
        activity = (await idb.getAll('activity')) ?? [];
        workouts = (await idb.getAll('workouts')) ?? [];
    }
    return {type: ANSWER, settings, activity: Array.isArray(activity) ? activity : [], workouts: Array.isArray(workouts) ? workouts : []};
}

// what infergno does with it: settings overwrite (they are the rider's real
// ones; this address's own keys are never touched), rides and workouts are
// added where this address does not already have them
export async function apply(data, {storage = globalThis.localStorage, idb} = {}) {
    let settings = 0, rides = 0, workouts = 0;
    for(const [k, v] of Object.entries(data?.settings ?? {})) {
        if(!carried(k) || typeof v !== 'string') continue;
        try { storage.setItem(renamed(k), v); settings++; } catch(e) {}
    }
    if(idb) {
        const have = new Set(((await idb.getAll('activity')) ?? []).map((r) => r?.id));
        for(const r of data?.activity ?? []) {
            if(!r?.id || have.has(r.id)) continue;
            await idb.put('activity', r); rides++;
        }
        const haveW = new Set(((await idb.getAll('workouts')) ?? []).map((w) => w?.id));
        for(const w of data?.workouts ?? []) {
            if(!w?.id || haveW.has(w.id)) continue;
            await idb.put('workouts', w); workouts++;
        }
    }
    return {settings, rides, workouts};
}
