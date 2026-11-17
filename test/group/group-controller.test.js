/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import { GroupController, readLink, rideLink } from '../../src/group/group.js';
import { Clock } from '../../src/group/clock.js';

const workout = {meta: {name: 'VO2'}, intervals: [
    {duration: 60, steps: [{duration: 60, power: 0.5}]},
    {duration: 90, steps: [{duration: 60, power: 1.2}, {duration: 30, power: 0.5}]},
]};
const START = 1_800_000_000_000;
const RIDE = {id: 'abcdefghjk', title: 'VO2', startAt: START, durationS: 150, lobbyS: 900, workout, closed: null};

// what the app was told, in order
let events = [];
const WATCH = ['ui:watchStart', 'workout:started', 'workout:done', 'workout:stopped', 'watch:intervalIndex', 'watch:stepIndex',
    'watch:lap', 'watch:lapTime', 'watch:stepTime', 'watch:beep', 'group:mode', 'group:stage', 'workout'];
WATCH.forEach((e) => xf.sub(e, (v) => events.push([e, v])));
const seen = (name) => events.filter(([e]) => e === name).map(([, v]) => v);

function memoryStorage(init = {}) {
    const m = new Map(Object.entries(init));
    return {getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m};
}

function FakeWS() {
    const made = [];
    class WS {
        constructor(url) { this.url = url; this.readyState = 0; this.sent = []; made.push(this); }
        open() { this.readyState = 1; this.onopen?.(); }
        message(m) { this.onmessage?.({data: JSON.stringify(m)}); }
        send(s) { this.sent.push(JSON.parse(s)); }
        close() { this.readyState = 3; }
        serverClose(code) { this.readyState = 3; this.onclose?.({code}); }
    }
    return {WS, made};
}

function setup({storage = memoryStorage(), serverUp = true, now = START - 5 * 60 * 1000} = {}) {
    let t = now;
    const clock = Clock({local: () => t});
    clock.onPong({t0: 0, server: 0}, 0);           // in sync with the server already
    const {WS, made} = FakeWS();
    const calls = [];
    const fetch = async (url, opts = {}) => {
        calls.push([url, opts]);
        if(!serverUp) throw new Error('offline');
        if(url === `/api/group/${RIDE.id}`) return {ok: true, status: 200, json: async () => ({...RIDE, server: t})};
        if(url.endsWith('/join')) return {ok: true, status: 200, json: async () => ({riderId: 'r_me', token: 'tok', host: false, name: 'Me'})};
        throw new Error(url);
    };
    let tick = null;
    const g = GroupController({
        fetch, storage, clock, WebSocketImpl: WS,
        location: {search: `?g=${RIDE.id}`, hash: '#k=thekey', protocol: 'https:', host: 'auuki.test', pathname: '/'},
        history: {replaceState() {}},
        makeTicker: (fn) => ({start: () => { tick = fn; }, stop: () => { tick = null; }}),
        startMedia: async () => null,
    });
    g.wire();
    return {
        g, made, calls, storage,
        at: (ms) => { t = ms; tick?.(); },
        // the ticker, a second at a time, from where we are
        ride: (fromMs, toMs) => { for(let x = fromMs; x <= toMs; x += 1000) { t = x; tick?.(); } },
    };
}

beforeEach(() => { events = []; });

describe('links', () => {
    test('read and made', () => {
        expect(readLink({search: '?g=abcdefghjk', hash: '#k=KEY&h=HOST'})).toEqual({id: 'abcdefghjk', key: 'KEY', hostKey: 'HOST'});
        expect(readLink({search: '?g=nope', hash: ''})).toBe(null);
        expect(readLink({search: '', hash: ''})).toBe(null);
        expect(rideLink('https://a.b', 'abcdefghjk', 'K')).toBe('https://a.b/?g=abcdefghjk#k=K');
        expect(rideLink('https://a.b', 'abcdefghjk', 'K', 'H')).toBe('https://a.b/?g=abcdefghjk#k=K&h=H');
    });
});

describe('a group ride, start to finish', () => {
    test('join, warm up, ride the workout on the clock, cool down', async () => {
        const s = setup();
        await s.g.start();
        expect(s.g.stage()).toBe('join');
        await s.g.join({name: 'Me'});
        expect(s.g.stage()).toBe('riding');
        expect(seen('group:mode')).toEqual([true]);
        expect(seen('workout')[0].meta.name).toBe('VO2');
        expect(s.made[0].url).toBe(`wss://auuki.test/api/group/${RIDE.id}/ws?token=tok`);

        s.made[0].open();
        expect(s.made[0].sent[0]).toMatchObject({type: 'hello'});

        // warmup: nothing happens to the workout
        s.ride(START - 3000, START - 1000);
        expect(seen('workout:started')).toEqual([]);
        expect(s.made[0].sent.filter(m => m.type === 's').length).toBeGreaterThan(0);

        // the start: the recording starts, the workout starts, interval 0
        xf.dispatch('db:watchStatus', {watchStatus: 'stopped'});
        s.at(START);
        expect(seen('ui:watchStart').length).toBe(1);
        expect(seen('workout:started').length).toBe(1);
        expect(seen('watch:intervalIndex')).toEqual([0]);
        expect(seen('watch:stepIndex')).toEqual([0]);
        expect(seen('watch:lapTime').at(-1)).toBe(60);

        // interval 1 at 60 s, its second step at 120 s, a beep 4 s before each interval ends
        xf.dispatch('db:watchStatus', {watchStatus: 'started'});
        s.ride(START + 1000, START + 125000);
        expect(seen('watch:intervalIndex')).toEqual([0, 1]);
        expect(seen('watch:stepIndex')).toEqual([0, 0, 1]);
        expect(seen('watch:beep').length).toBe(1);   // at 56 s; the next is at 146 s
        expect(seen('watch:lap').length).toBe(1);

        // cooldown
        s.ride(START + 126000, START + 152000);
        expect(seen('watch:beep').length).toBe(2);
        expect(seen('workout:done').length).toBe(1);
        expect(s.g.phase()).toBe('cooldown');
        expect(s.made[0].sent.find(m => m.type === 'summary')).toMatchObject({seconds: 150});
    });

    test('a reload mid-interval lands on the same second, without a lap', async () => {
        const storage = memoryStorage();
        const first = setup({storage});
        await first.g.start();
        await first.g.join({name: 'Me'});
        first.ride(START, START + 2000);
        first.g.leave = () => {};                 // the page just goes away

        events = [];
        const second = setup({storage, now: START + 75500});
        xf.dispatch('db:watchStatus', {watchStatus: 'paused'});    // the restored ride
        await second.g.start();
        expect(second.g.stage()).toBe('riding');                     // no join screen
        expect(seen('watch:intervalIndex')).toEqual([1]);
        expect(seen('watch:stepIndex')).toEqual([0]);
        expect(seen('watch:lapTime').at(-1)).toBe(75);
        expect(seen('watch:stepTime').at(-1)).toBe(45);
        expect(seen('watch:lap')).toEqual([]);
        expect(seen('ui:watchStart')).toEqual([]);                   // paused stays paused
    });

    test('with the server down, a reload still rides the workout', async () => {
        const storage = memoryStorage();
        const first = setup({storage});
        await first.g.start();
        await first.g.join({name: 'Me'});

        events = [];
        const second = setup({storage, serverUp: false, now: START + 61000});
        await second.g.start();
        expect(second.g.stage()).toBe('riding');
        expect(seen('watch:intervalIndex')).toEqual([1]);
        second.ride(START + 62000, START + 121000);
        expect(seen('watch:stepIndex')).toEqual([0, 1]);
    });

    test('removed by the host: out of group mode, the recording carries on', async () => {
        const s = setup();
        await s.g.start();
        await s.g.join({name: 'Me'});
        s.made[0].open();
        s.made[0].serverClose(4003);
        expect(s.g.stage()).toBe('ended');
        expect(seen('group:mode')).toEqual([true, false]);
        expect(seen('group:stage').at(-1)).toMatchObject({stage: 'ended', code: 4003});
    });

    test('the lobby not open yet keeps the join screen, with when it opens', async () => {
        const s = setup({now: START - 20 * 60 * 1000});
        s.g.start = s.g.start;
        await s.g.start();
        // the server says too early
        const fetch425 = async () => ({ok: false, status: 425, json: async () => ({opensAt: START - 900000})});
        const g = GroupController({
            fetch: async (url, o) => (url.endsWith('/join') ? fetch425() : {ok: true, status: 200, json: async () => ({...RIDE, server: START})}),
            storage: memoryStorage(), clock: Clock({local: () => START - 20 * 60 * 1000}), WebSocketImpl: FakeWS().WS,
            location: {search: `?g=${RIDE.id}`, hash: '#k=k', protocol: 'https:', host: 'x', pathname: '/'},
            makeTicker: () => ({start() {}, stop() {}}), startMedia: async () => null,
        });
        await g.start();
        events = [];
        await g.join({name: 'Me'});
        expect(g.stage()).toBe('join');
        expect(seen('group:stage').at(-1)).toMatchObject({stage: 'join', opensAt: START - 900000});
    });
});
