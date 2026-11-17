import { Connection, backoff, isTerminal } from '../../src/group/connection.js';

// a socket the test drives by hand
function FakeSockets() {
    const made = [];
    class FakeWS {
        constructor(url) { this.url = url; this.readyState = 0; this.sent = []; made.push(this); }
        open() { this.readyState = 1; this.onopen?.(); }
        message(obj) { this.onmessage?.({data: JSON.stringify(obj)}); }
        serverClose(code = 1006) { this.readyState = 3; this.onclose?.({code}); }
        send(s) { this.sent.push(JSON.parse(s)); }
        close() { this.readyState = 3; this.closed = true; }
    }
    return {FakeWS, made};
}

// timers the test steps through
function FakeTime() {
    let t = 0, id = 0;
    const timers = new Map();
    return {
        now: () => t,
        setTimer: (fn, ms) => { timers.set(++id, {fn, at: t + ms}); return id; },
        clearTimer: (i) => timers.delete(i),
        advance(ms) {
            const end = t + ms;
            for(;;) {
                const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if(!due) break;
                timers.delete(due[0]);
                t = due[1].at;
                due[1].fn();
            }
            t = end;
        },
    };
}

function setup(extra = {}) {
    const {FakeWS, made} = FakeSockets();
    const time = FakeTime();
    const states = [];
    const messages = [];
    let opens = 0;
    const conn = Connection({
        url: () => `wss://x/ws?n=${made.length}`,
        WebSocketImpl: FakeWS,
        setTimer: time.setTimer, clearTimer: time.clearTimer, now: time.now,
        random: () => 0.5,
        onState: (s) => states.push(s),
        onMessage: (m) => messages.push(m),
        onOpen: () => { opens += 1; },
        ...extra,
    });
    return {conn, made, time, states, messages, opens: () => opens};
}

describe('backoff', () => {
    test('grows, caps at 10 s, jitters ±30%', () => {
        expect([0, 1, 2, 3, 4, 9].map(a => backoff(a, () => 0.5))).toEqual([500, 1000, 2000, 4000, 10000, 10000]);
        expect(backoff(0, () => 0)).toBe(350);
        expect(backoff(0, () => 1)).toBe(650);
    });
    test('4000–4099 is the server saying stop', () => {
        expect(isTerminal(4000)).toBe(true);
        expect(isTerminal(4099)).toBe(true);
        expect(isTerminal(1006)).toBe(false);
        expect(isTerminal(1000)).toBe(false);
    });
});

describe('Connection', () => {
    test('opens, says so, and passes messages on', () => {
        const {conn, made, states, messages, opens} = setup();
        conn.connect();
        made[0].open();
        made[0].message({type: 'tick'});
        expect(states).toEqual(['connecting', 'open']);
        expect(opens()).toBe(1);
        expect(messages).toEqual([{type: 'tick'}]);
        expect(conn.send({type: 's'})).toBe(true);
        expect(made[0].sent).toEqual([{type: 's'}]);
    });
    test('a dropped socket comes back with backoff', () => {
        const {conn, made, time, states} = setup();
        conn.connect();
        made[0].open();
        made[0].serverClose(1006);
        expect(states.at(-1)).toBe('reconnecting');
        time.advance(499);
        expect(made.length).toBe(1);
        time.advance(1);
        expect(made.length).toBe(2);
        made[1].serverClose(1006);       // fails again before opening
        time.advance(999);
        expect(made.length).toBe(2);
        time.advance(1);
        expect(made.length).toBe(3);
        made[2].open();
        expect(states.at(-1)).toBe('open');
        made[2].serverClose(1006);       // a success resets the backoff
        time.advance(500);
        expect(made.length).toBe(4);
    });
    test('silence for more than 4 s is a dead socket', () => {
        const {conn, made, time} = setup();
        conn.connect();
        made[0].open();
        for(let i = 0; i < 10; i++) { time.advance(1000); made[0].message({type: 'tick'}); }
        expect(made.length).toBe(1);
        time.advance(5000);              // half-open: nothing arrives, no close event either
        expect(made[0].closed).toBe(true);
        time.advance(600);
        expect(made.length).toBe(2);
    });
    test('a terminal close code ends it for good', () => {
        const {conn, made, time, states} = setup();
        conn.connect();
        made[0].open();
        made[0].serverClose(4000);
        time.advance(60000);
        expect(made.length).toBe(1);
        expect(states.at(-1)).toBe('ended');
        expect(conn.send({})).toBe(false);
    });
    test('close() stops reconnecting', () => {
        const {conn, made, time} = setup();
        conn.connect();
        made[0].open();
        conn.close();
        made[0].serverClose(1006);
        time.advance(60000);
        expect(made.length).toBe(1);
    });
    test('drop() behaves like the network failing', () => {
        const {conn, made, time} = setup();
        conn.connect();
        made[0].open();
        conn.drop();
        time.advance(500);
        expect(made.length).toBe(2);
    });
});
