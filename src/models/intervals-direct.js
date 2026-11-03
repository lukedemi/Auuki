//
// intervals.icu, direct
//
// The upstream app talks to intervals.icu through api.auuki.com, a closed
// backend that holds the OAuth tokens. A self-hosted copy has no such backend,
// so this talks to the intervals.icu API straight from the browser with the
// athlete's own API key (intervals.icu > Settings > Developer Settings).
// intervals.icu answers CORS for any origin with an Authorization header.
//
// The key is kept in this browser's localStorage only. Athlete id 0 means
// "the athlete the key belongs to", so the key alone is enough.
//
// Same return shapes as the backend path in intervals.js, so the rest of the
// app does not know which one it is using.
//

const storageKey = 'intervals-direct';
const base = 'https://intervals.icu/api/v1';

// the event types a trainer can ride; intervals.icu also renders .zwo for
// strength sessions, which must not land in the Planned list
const rideTypes = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide'];

function storage() {
    try {
        return globalThis.localStorage;
    } catch(e) {
        return undefined;
    }
}

function load() {
    try {
        const value = JSON.parse(storage()?.getItem(storageKey) ?? '{}');
        return {
            athlete: String(value.athlete ?? '0').trim() || '0',
            key:     String(value.key ?? '').trim(),
        };
    } catch(e) {
        return {athlete: '0', key: ''};
    }
}

function save({athlete = '0', key = ''} = {}) {
    const value = {
        athlete: String(athlete).trim() || '0',
        key:     String(key).trim(),
    };
    try {
        storage()?.setItem(storageKey, JSON.stringify(value));
    } catch(e) {
        console.error(':intervals-direct :save :error', e);
    }
    return value;
}

function clear() {
    try {
        storage()?.removeItem(storageKey);
    } catch(e) {}
}

function isConfigured() {
    return load().key.length > 0;
}

function authHeader(key) {
    return 'Basic ' + btoa(`API_KEY:${key}`);
}

class IntervalsError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function request(path, opts = {}) {
    const {athlete, key} = load();
    if(!key) throw new IntervalsError(0, 'no intervals.icu API key set');

    const url = `${base}/athlete/${encodeURIComponent(athlete)}${path}`;
    const response = await fetch(url, Object.assign({}, opts, {
        headers: Object.assign({'Authorization': authHeader(key)}, opts.headers ?? {}),
    }));

    if(!response.ok) {
        let text = '';
        try { text = await response.text(); } catch(e) {}
        const reason = response.status === 401 || response.status === 403
              ? 'the API key or athlete id was refused'
              : `intervals.icu answered ${response.status}`;
        throw new IntervalsError(response.status, `${reason}${text ? ': ' + text.slice(0, 200) : ''}`);
    }

    const type = response.headers.get('content-type') ?? '';
    return type.includes('json') ? response.json() : response.text();
}

// planned rides between two ISO dates, each with its .zwo as base64
async function events(oldest, newest) {
    const params = new URLSearchParams({
        oldest,
        newest,
        category: 'WORKOUT',
        ext: 'zwo',
    });
    const data = await request(`/events?${params}`);
    return (data ?? []).filter((event) =>
        event.workout_file_base64 &&
        (!event.type || rideTypes.includes(event.type))
    );
}

// GET /athlete/{id}: name, weight, sportSettings (ftp per sport)
async function athlete() {
    return request('');
}

// upload a .fit; external_id makes a repeated upload of the same ride a no-op
async function upload(blob, {name, externalId} = {}) {
    const params = new URLSearchParams();
    if(name) params.set('name', name);
    if(externalId) params.set('external_id', externalId);

    const form = new FormData();
    form.append('file', blob, 'auuki.fit');

    return request(`/activities?${params}`, {method: 'POST', body: form});
}

export default Object.freeze({
    load,
    save,
    clear,
    isConfigured,
    events,
    athlete,
    upload,
    rideTypes,
    IntervalsError,
});
