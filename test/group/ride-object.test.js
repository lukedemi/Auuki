/**
 * @jest-environment node
 */
import { GroupRide, CLOSE, TICK_MS, EMPTY_CLOSE_MS } from '../../workers/group/src/ride.js';
import { timeline } from '../../src/group/schedule.js';

const workout = {meta: {name: 'VO2'}, intervals: [
    {duration: 60, steps: [{duration: 60, power: 0.5}]},
    {duration: 120, steps: [{duration: 120, power: 1.2}]},
]};
const START = 1_800_000_000_000;

function FakeStorage() {
    const store = new Map();
    let alarm = null;
    return {
        store,
        alarm: () => alarm,
        get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
        put: async (k, v) => { store.set(k, structuredClone(v)); },
        delete: async (k) => store.delete(k),
        setAlarm: async (t) => { alarm = t; },
        getAlarm: async () => alarm,
        deleteAlarm: async () => { alarm = null; },
    };
}

function FakeSocket() {
    let att = null;
    return {
        readyState: 1, sent: [], closedWith: null, tags: [],
        send(t) { if(this.readyState !== 1) throw new Error('closed'); this.sent.push(JSON.parse(t)); },
        close(code) { this.readyState = 3; this.closedWith = code; },
        serializeAttachment(v) { att = structuredClone(v); },
        deserializeAttachment() { return structuredClone(att); },
        last(type) { return [...this.sent].reverse().find(m => m.type === type); },
    };
}

function FakeCtx(storage = FakeStorage()) {
    const sockets = [];
    return {
        storage, sockets,
        acceptWebSocket(ws, tags) { ws.tags = tags; sockets.push(ws); },
        getWebSockets(tag) { return sockets.filter(s => s.readyState === 1 && (!tag || s.tags.includes(tag))); },
    };
}

function make(ctx = FakeCtx(), env = {}) {
    const ride = new GroupRide(ctx, env);
    let t = START - 5 * 60 * 1000;
    ride.now = () => t;
    ride.makePair = () => { const s = FakeSocket(); return [{client: true}, s]; };
    ride.upgraded = (client) => ({status: 101, client});
    return {ride, ctx, at: (ms) => { t = ms; }, now: () => t};
}

async function init(ride) {
    const body = {id: 'abcdefghjk', title: 'Tuesday VO2', workout, timeline: timeline(workout), startAt: START, lobbyS: 900};
    return ride.fetch(new Request('https://do/init', {method: 'POST', body: JSON.stringify(body)}));
}

async function connect(ride, ctx, p, n = p, h = false) {
    const req = new Request('https://do/ws', {headers: {Upgrade: 'websocket', 'X-Rider': JSON.stringify({p, n, h})}});
    const res = await ride.fetch(req);
    expect(res.status).toBe(101);
    return ctx.sockets.at(-1);
}

const msg = (ride, ws, m) => ride.webSocketMessage(ws, JSON.stringify(m));

describe('GroupRide', () => {
    test('init stores the ride and arms the lobby, start and end alarms in turn', async () => {
        const {ride, ctx, at} = make();
        at(START - 20 * 60 * 1000);
        expect((await init(ride)).status).toBe(200);
        expect(ctx.storage.alarm()).toBe(START - 15 * 60 * 1000);
        expect((await init(ride)).status).toBe(409);
        at(START - 15 * 60 * 1000);
        await ride.alarm();
        expect(ctx.storage.alarm()).toBe(START);
        at(START);
        await ride.alarm();
        expect(ctx.storage.alarm()).toBe(START + 180 * 1000);
    });

    test('hello gets the ride, the roster and everyone\'s history — not the internals', async () => {
        const {ride, ctx} = make();
        await init(ride);
        const a = await connect(ride, ctx, 'r_a', 'Ann', true);
        await msg(ride, a, {type: 'hello'});
        const w = a.last('welcome');
        expect(w).toMatchObject({you: 'r_a', host: true, phase: 'warmup', ride: {title: 'Tuesday VO2', startAt: START, durationS: 180}});
        expect(w.ride.timeline).toBeUndefined();
        expect(w.roster.r_a).toMatchObject({name: 'Ann', connected: true, host: true});
    });

    test('one tick a second carries everyone\'s latest', async () => {
        const {ride, ctx, at, now} = make();
        await init(ride);
        const a = await connect(ride, ctx, 'r_a');
        const b = await connect(ride, ctx, 'r_b');
        await msg(ride, a, {type: 's', w: 250, hr: 150, cad: 90, tgt: 250, ftp: 280, st8: 'r'});
        const first = b.last('tick');
        expect(first.riders.r_a).toMatchObject({w: 250, hr: 150, cad: 90, tgt: 250, ftp: 280, st8: 'r'});
        at(now() + 300);
        await msg(ride, b, {type: 's', w: 180});
        expect(b.sent.filter(m => m.type === 'tick').length).toBe(1);   // too soon for another
        at(now() + TICK_MS);
        await msg(ride, a, {type: 's', w: 260});
        const second = b.last('tick');
        expect(Object.keys(second.riders).sort()).toEqual(['r_a', 'r_b']);
        expect(second.riders.r_b.age).toBe(0.9);
    });

    test('garbage in a sample is cleaned, not stored', async () => {
        const {ride, ctx} = make();
        await init(ride);
        const a = await connect(ride, ctx, 'r_a');
        await msg(ride, a, {type: 's', w: 99999, hr: 'x', st8: '<script>'});
        expect(a.last('tick').riders.r_a).toMatchObject({w: 0, hr: null, st8: 'r'});
    });

    test('ping is answered with server time', async () => {
        const {ride, ctx, now} = make();
        await init(ride);
        const a = await connect(ride, ctx, 'r_a');
        await msg(ride, a, {type: 'ping', t0: 123});
        expect(a.last('pong')).toMatchObject({t0: 123, server: now()});
    });

    test('a restart loses memory, and the riders\' hellos rebuild it', async () => {
        const storage = FakeStorage();
        const one = make(FakeCtx(storage));
        await init(one.ride);
        const a = await connect(one.ride, one.ctx, 'r_a', 'Ann');
        for(let i = 0; i < 5; i++) { one.at(one.now() + 1000); await msg(one.ride, a, {type: 's', w: 200 + i}); }

        // the object is evicted; a new instance, same storage
        const two = make(FakeCtx(storage));
        two.at(one.now() + 3000);
        const a2 = await connect(two.ride, two.ctx, 'r_a', 'Ann');
        const history = [[1, 200, null, null, 200], [2, 201, null, null, 200], [3, 202, null, null, 200]];
        await msg(two.ride, a2, {type: 'hello', history});
        const w = a2.last('welcome');
        expect(w.roster.r_a.name).toBe('Ann');
        expect(w.history.r_a).toEqual(history);
        expect(w.ride.title).toBe('Tuesday VO2');
    });

    test('reconnecting replaces the old socket', async () => {
        const {ride, ctx} = make();
        await init(ride);
        const old = await connect(ride, ctx, 'r_a');
        const fresh = await connect(ride, ctx, 'r_a');
        expect(old.closedWith).toBe(CLOSE.replaced);
        expect(fresh.readyState).toBe(1);
        await ride.webSocketClose(old);
        // the old socket closing doesn't mark the rider gone
        await msg(ride, fresh, {type: 'hello'});
        expect(fresh.last('welcome').roster.r_a.connected).toBe(true);
    });

    test('leaving shows in the roster', async () => {
        const {ride, ctx} = make();
        await init(ride);
        const a = await connect(ride, ctx, 'r_a');
        const b = await connect(ride, ctx, 'r_b');
        b.close(1006);
        await ride.webSocketClose(b);
        expect(a.last('roster').roster.r_b.connected).toBe(false);
    });

    test('only the host can remove someone, and they stay removed', async () => {
        const {ride, ctx} = make();
        await init(ride);
        const host = await connect(ride, ctx, 'r_h', 'Host', true);
        const a = await connect(ride, ctx, 'r_a');
        const b = await connect(ride, ctx, 'r_b');
        await msg(ride, a, {type: 'kick', id: 'r_b'});
        expect(b.readyState).toBe(1);
        await msg(ride, host, {type: 'kick', id: 'r_b'});
        expect(b.closedWith).toBe(CLOSE.removed);
        expect(host.last('roster').roster.r_b).toBeUndefined();
        const again = await connect(ride, ctx, 'r_b');
        expect(again.closedWith).toBe(CLOSE.removed);
    });

    test('the host closing ends it for everyone and writes the record', async () => {
        const batches = [];
        const db = {
            prepare: (sql) => ({bind: (...args) => ({sql, args})}),
            batch: async (stmts) => { batches.push(stmts); },
        };
        const {ride, ctx} = make(FakeCtx(), {DB: db});
        await init(ride);
        const host = await connect(ride, ctx, 'r_h', 'Host', true);
        const a = await connect(ride, ctx, 'r_a');
        await msg(ride, a, {type: 'summary', avg_w: 231, np_w: 250, avg_hr: 151, kj: 400});
        await msg(ride, a, {type: 'close'});                       // not the host: ignored
        expect(a.readyState).toBe(1);
        await msg(ride, host, {type: 'close'});
        expect(a.last('closed')).toBeTruthy();
        expect(a.closedWith).toBe(CLOSE.closed);
        expect(ctx.storage.alarm()).toBe(null);
        const rows = batches[0].filter(s => s.sql.includes('group_riders'));
        expect(rows.find(r => r.args.includes('r_a')).args.slice(1, 5)).toEqual([231, 250, 151, 400]);
        const late = await connect(ride, ctx, 'r_c');
        expect(late.closedWith).toBe(CLOSE.closed);
    });

    test('after the end, it closes once everyone has been gone 10 minutes', async () => {
        const {ride, ctx, at} = make(FakeCtx(), {DB: {prepare: () => ({bind: () => ({})}), batch: async () => {}}});
        await init(ride);
        const end = START + 180 * 1000;
        const a = await connect(ride, ctx, 'r_a');
        at(end);
        await ride.alarm();                        // cooldown, someone still riding
        expect(ctx.storage.alarm()).toBeGreaterThan(end);
        a.close(1000);
        await ride.webSocketClose(a);
        at(end + 5 * 60 * 1000);
        await ride.alarm();                        // empty: the clock starts
        expect(ctx.storage.store.get('ride').closed).toBe(null);
        at(end + 5 * 60 * 1000 + EMPTY_CLOSE_MS);
        await ride.alarm();
        expect(ctx.storage.store.get('ride').closed).not.toBe(null);
    });
});
