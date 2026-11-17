//
// Moving the household from auuki.d3-mi.com to ergatory.d3-mi.com (rider,
// Nov 17, 2026: "transfer as many settings to me as you can without me
// having to do it").
//
// A browser keeps each site's data apart, but the two share d3-mi.com, so
// ergatory can open auuki's /transfer.html in a hidden frame: same-site, the
// frame gets auuki's own storage and its Access sign-in. The frame answers
// one request, from ergatory only, with what this browser holds there:
// every localStorage setting and the saved rides and workouts. ergatory
// stores them (transfer-in in household.js's sign-in flow) and reloads.
//
// Not moved: Bluetooth pairings (Chrome grants those per site; pair once),
// the ride in progress, and anything ergatory already has of its own
// (its Strava connection, its household sign-in).
//

export const FROM = 'https://auuki.d3-mi.com';
export const TO = 'https://ergatory.d3-mi.com';
export const REQUEST = 'ergatory-transfer-request';
export const ANSWER = 'ergatory-transfer';

// settings that belong to the site, not the rider: never carried over
export const KEEP_LOCAL = [/^ergatory:/, /^ble:remembered$/];
export const carried = (key) => !KEEP_LOCAL.some((re) => re.test(key));

// what the old site sends: its settings and its saved rides and workouts
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

// what ergatory does with it: settings overwrite (they are the rider's real
// ones; this site's own keys are never touched), rides and workouts are added
// where this site does not already have them
export async function apply(data, {storage = globalThis.localStorage, idb} = {}) {
    let settings = 0, rides = 0, workouts = 0;
    for(const [k, v] of Object.entries(data?.settings ?? {})) {
        if(!carried(k) || typeof v !== 'string') continue;
        try { storage.setItem(k, v); settings++; } catch(e) {}
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
