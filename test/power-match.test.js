/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import appPowerMatch, { PowerMatchCore, PowerMatch, settle, shouldCorrect } from '../src/power-match.js';

// the app's own instance listens to the same events; only the tests' own speak here
appPowerMatch.stop();

// feed paired 1 Hz samples: trainer and meter each second
function ride(core, {seconds, trainer, meter, t0 = 0}) {
    let t = t0;
    for(let i = 0; i < seconds; i++) {
        t = t0 + i * 1000;
        core.onTrainer(typeof trainer === 'function' ? trainer(i) : trainer, t);
        core.onMeter(typeof meter === 'function' ? meter(i) : meter, t + 200);
    }
    return t + 1000;
}

describe('PowerMatchCore', () => {

    test('passes the target through until warmed up', () => {
        const core = PowerMatchCore();
        expect(core.isReady()).toBe(false);
        expect(core.adjust(250)).toBe(250);

        ride(core, {seconds: 10, trainer: 250, meter: 240});
        expect(core.isReady()).toBe(false);
        expect(core.adjust(250)).toBe(250);
    });

    test('pedals reading 4% low: asks the trainer for more', () => {
        const core = PowerMatchCore();
        ride(core, {seconds: 120, trainer: 250, meter: 240});

        expect(core.isReady()).toBe(true);
        expect(core.ratio()).toBeCloseTo(0.96, 3);
        expect(core.adjust(250)).toBe(260);
        expect(core.adjust(207)).toBe(216);
    });

    test('pedals reading high: asks the trainer for less', () => {
        const core = PowerMatchCore();
        ride(core, {seconds: 120, trainer: 200, meter: 210});
        expect(core.adjust(300)).toBe(286);
    });

    test('the ratio is independent of the power level', () => {
        const core = PowerMatchCore();
        // intervals: 2 min at 300 / 1 min at 150, pedals 3% low throughout
        ride(core, {
            seconds: 600,
            trainer: i => (i % 180) < 120 ? 300 : 150,
            meter:   i => ((i % 180) < 120 ? 300 : 150) * 0.97,
        });
        expect(core.ratio()).toBeCloseTo(0.97, 3);
    });

    test('ignores coasting and low power', () => {
        const core = PowerMatchCore();
        ride(core, {seconds: 120, trainer: 250, meter: 240});
        const before = core.ratio();
        // stops pedalling: trainer still spins down, meter 0
        ride(core, {seconds: 60, trainer: 30, meter: 0, t0: 120000});
        expect(core.ratio()).toBe(before);
    });

    test('ignores a stale trainer reading', () => {
        const core = PowerMatchCore();
        core.onTrainer(250, 0);
        for(let i = 0; i < 60; i++) {
            core.onMeter(200, 5000 + i * 1000);
        }
        expect(core.isReady()).toBe(false);
    });

    test('clamps a ratio that can only be a fault', () => {
        const core = PowerMatchCore();
        ride(core, {seconds: 120, trainer: 250, meter: 125});
        expect(core.ratio()).toBe(0.8);
        expect(core.adjust(200)).toBe(250);
    });

    test('a zero target stays zero', () => {
        const core = PowerMatchCore();
        ride(core, {seconds: 120, trainer: 250, meter: 240});
        expect(core.adjust(0)).toBe(0);
    });

    test('reset forgets the calibration', () => {
        const core = PowerMatchCore();
        ride(core, {seconds: 120, trainer: 250, meter: 240});
        core.reset();
        expect(core.isReady()).toBe(false);
        expect(core.adjust(250)).toBe(250);
    });
});

describe('PowerMatch wiring', () => {
    let pm, clock, sent, abort;

    beforeEach(() => {
        clock = 0;
        sent = [];
        abort = new AbortController();
        // the module also starts a default instance on import; only count
        // what this one would send by comparing its own trainerTarget()
        pm = PowerMatch({now: () => clock});
        pm.start();
        xf.sub('trainer:powerTarget', v => sent.push(v), {signal: abort.signal});
    });

    afterEach(() => {
        pm.stop();
        abort.abort();
    });

    function tick(seconds, trainer, meter) {
        for(let i = 0; i < seconds; i++) {
            clock += 1000;
            xf.dispatch('ble:controllable:power', trainer);
            xf.dispatch('ble:powerMeter:power', meter);
        }
    }

    test('off when the trainer is the power source', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:controllable'}});
        xf.dispatch('db:powerTarget', {powerTarget: 250});
        tick(120, 250, 240);
        expect(pm.trainerTarget()).toBe(250);
    });

    test('on when the power meter is the source', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter'}});
        xf.dispatch('db:powerTarget', {powerTarget: 250});
        expect(pm.trainerTarget()).toBe(250);
        tick(120, 250, 240);
        expect(pm.trainerTarget()).toBe(260);
        expect(sent).toContain(260);
    });

    test('respects the setting', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter', powerMatch: false}});
        xf.dispatch('db:powerTarget', {powerTarget: 250});
        tick(120, 250, 240);
        expect(pm.trainerTarget()).toBe(250);
    });

    test('a new interval goes out already corrected', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter'}});
        xf.dispatch('db:powerTarget', {powerTarget: 200});
        tick(120, 200, 192);
        sent.length = 0;
        xf.dispatch('db:powerTarget', {powerTarget: 300});
        expect(sent).toContain(313);
    });

    test('meter disconnect falls back to the raw target', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter'}});
        xf.dispatch('db:powerTarget', {powerTarget: 250});
        tick(120, 250, 240);
        sent.length = 0;
        xf.dispatch('ble:powerMeter:disconnected');
        expect(sent).toContain(250);
    });

    test('logs every sample and event, and exports CSV', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter'}});
        xf.dispatch('db:powerTarget', {powerTarget: 250});
        tick(20, 250, 240);
        const log = pm.log();
        expect(log.length).toBeGreaterThanOrEqual(21);
        expect(log.some(r => r.event === 'target')).toBe(true);

        const lines = pm.csv().trim().split('\n');
        expect(lines[0]).toBe('t,time,event,enabled,sim,ready,paired,ratio,target,sent,trainer,meter,emaTrainer,emaMeter,source,steady,calm,hold');
        expect(lines.length).toBe(log.length + 1);

        pm.clear();
        expect(pm.log().length).toBe(1);
    });

    test('learns while the trainer is the source, applies once switched', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:controllable'}});
        xf.dispatch('db:powerTarget', {powerTarget: 250});
        tick(120, 250, 240);
        expect(pm.trainerTarget()).toBe(250);
        sent.length = 0;
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter'}});
        expect(sent).toContain(260);
    });
});

describe('PowerMatch simulation', () => {
    let pm, clock, sent, abort;

    beforeEach(() => {
        jest.useFakeTimers();
        clock = 0;
        sent = [];
        abort = new AbortController();
        pm = PowerMatch({now: () => clock});
        pm.start();
        xf.sub('trainer:powerTarget', v => sent.push(v), {signal: abort.signal});
    });

    afterEach(() => {
        pm.stop();
        abort.abort();
        jest.useRealTimers();
    });

    function run(seconds) {
        for(let i = 0; i < seconds; i++) {
            clock += 1000;
            jest.advanceTimersByTime(1000);
        }
    }

    test('the simulated meter converges on the target', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:controllable'}});
        xf.dispatch('db:powerTarget', {powerTarget: 250});
        pm.simulate(true, {offset: 1.05});
        expect(pm.isSimulating()).toBe(true);
        run(180);

        const recent = pm.log().slice(-30).filter(r => r.event === '');
        const meter = recent.reduce((a, r) => a + r.meter, 0) / recent.length;
        expect(Math.abs(meter - 250)).toBeLessThan(4);
        expect(pm.trainerTarget()).toBeGreaterThan(234);
        expect(pm.trainerTarget()).toBeLessThan(242);

        pm.simulate(false);
        expect(pm.isSimulating()).toBe(false);
        expect(pm.trainerTarget()).toBe(250);
    });
});


describe('settling into a long interval', () => {
    test('fast for the first minute, calm by ten, in between on the way', () => {
        const start = settle(10, 286);
        expect(start).toMatchObject({k: 0, tau: 20, every: 3000, delta: 2});
        const mid = settle(330, 286);
        expect(mid.k).toBeCloseTo(0.5, 5);
        expect(mid.tau).toBeCloseTo(70, 5);
        const calm = settle(1800, 286);
        expect(calm).toMatchObject({k: 1, tau: 120, every: 30000});
        expect(calm.delta).toBeCloseTo(5.72, 2);
        expect(calm.slow).toBe(90000);
    });

    test('a calm interval lets a small gap wait, a big one less, and closes both eventually', () => {
        const calm = settle(1800, 286);
        expect(shouldCorrect(4, 10000, calm)).toBe(false);   // small, recent
        expect(shouldCorrect(4, 60000, calm)).toBe(false);   // small, still in the slow lane
        expect(shouldCorrect(4, 90000, calm)).toBe(true);    // small, eventually
        expect(shouldCorrect(8, 20000, calm)).toBe(false);   // big, not yet
        expect(shouldCorrect(8, 30000, calm)).toBe(true);    // big, after the calm interval
        expect(shouldCorrect(1, 600000, calm)).toBe(false);  // under 2 W never goes
        const start = settle(0, 286);
        expect(shouldCorrect(3, 3000, start)).toBe(true);    // a fresh interval reacts as before
    });
});

describe('PowerMatch settling, wired', () => {
    let pm, clock, sent, abort;

    beforeEach(() => {
        clock = 0;
        sent = [];
        abort = new AbortController();
        pm = PowerMatch({now: () => clock});
        pm.start();
        xf.sub('trainer:powerTarget', v => sent.push([clock, v]), {signal: abort.signal});
    });

    afterEach(() => { pm.stop(); abort.abort(); });

    function tick(seconds, trainer, meter) {
        for(let i = 0; i < seconds; i++) {
            clock += 1000;
            xf.dispatch('ble:controllable:power', typeof trainer === 'function' ? trainer() : trainer);
            xf.dispatch('ble:powerMeter:power', typeof meter === 'function' ? meter() : meter);
        }
    }

    // `before` seconds at one target with the pedals 2% low, then the pedals
    // drift to 5% low for five minutes: the corrections sent in the drift
    function drift(before) {
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter'}});
        xf.dispatch('db:powerTarget', {powerTarget: 286});
        tick(before, 286, 280);
        const from = sent.length, t0 = clock;
        let reached = null;
        for(let i = 0; i < 300; i++) {
            tick(1, 286, 286 * 0.95);
            const lastSent = sent.length ? sent[sent.length - 1][1] : 0;
            if(reached == null && sent.length > from && lastSent >= 298) reached = (clock - t0) / 1000;
        }
        const corrections = sent.slice(from);
        return {corrections, target: corrections.length ? corrections[corrections.length - 1][1] : null, reached};
    }

    test('fifteen minutes into an interval, a drift is corrected calmly and still closed', () => {
        const late = drift(900);
        expect(late.corrections.length).toBeGreaterThan(0);
        const gaps = late.corrections.slice(1).map((c, i) => c[0] - late.corrections[i][0]);
        gaps.forEach(g => expect(g).toBeGreaterThanOrEqual(30000));
        expect(late.target).toBeGreaterThanOrEqual(298);   // 286 / 0.95 = 301, most of the way there
        expect(late.reached).toBeGreaterThan(120);         // and it took its time: the trainer is not chased
    });

    test('twenty seconds into an interval, the same drift is chased quickly', () => {
        const early = drift(20);
        expect(early.corrections[1][0] - early.corrections[0][0]).toBeLessThan(10000);
        expect(early.reached).toBeLessThan(60);         // what the trainer was sent, within a minute
    });

    test('the debug snapshot says how long the target has held and how calm it is', () => {
        xf.dispatch('db:powerTarget', {powerTarget: 200});
        clock += 330000;
        const s = pm.snapshot();
        expect(s.steady).toBe(330);
        expect(s.calm).toBeCloseTo(0.5, 5);
    });
});

describe('easing back in after a pause', () => {
    let pm, clock, sent, abort;

    beforeEach(() => {
        jest.useFakeTimers();
        clock = 0;
        sent = [];
        abort = new AbortController();
        pm = PowerMatch({now: () => clock});
        pm.start();
        xf.sub('trainer:powerTarget', v => sent.push(v), {signal: abort.signal});
    });

    afterEach(() => { pm.stop(); abort.abort(); jest.useRealTimers(); });

    const status = (s) => xf.dispatch('db:watchStatus', {watchStatus: s});
    function run(seconds) {
        for(let i = 0; i < seconds; i++) { clock += 1000; jest.advanceTimersByTime(1000); }
    }

    test('paused, the trainer holds 100 W; resumed, it ramps to the target over 20 s', () => {
        status('started');
        run(25);
        xf.dispatch('db:powerTarget', {powerTarget: 286});
        expect(pm.trainerTarget()).toBe(286);

        status('paused');
        expect(sent[sent.length - 1]).toBe(100);
        expect(pm.isEasing()).toBe(true);

        sent.length = 0;
        status('started');
        expect(sent[0]).toBe(100);
        run(10);
        const mid = sent[sent.length - 1];
        expect(mid).toBeGreaterThan(180);
        expect(mid).toBeLessThan(205);       // halfway: 100 + 186 / 2 = 193
        run(12);
        expect(sent[sent.length - 1]).toBe(286);
        expect(pm.isEasing()).toBe(false);
    });

    test('an easy target is never raised to the floor', () => {
        status('started');
        run(25);
        xf.dispatch('db:powerTarget', {powerTarget: 80});
        status('paused');
        expect(sent[sent.length - 1]).toBe(80);
    });

    test('a ride starting from stopped also ramps in', () => {
        xf.dispatch('db:powerTarget', {powerTarget: 250});
        sent.length = 0;
        status('started');
        expect(sent[0]).toBe(100);
        run(21);
        expect(sent[sent.length - 1]).toBe(250);
    });
});

describe('a new interval: the calibration holds, a step up ramps in', () => {
    let pm, clock, sent, abort;

    beforeEach(() => {
        jest.useFakeTimers();
        clock = 0;
        sent = [];
        abort = new AbortController();
        pm = PowerMatch({now: () => clock});
        pm.start();
        xf.sub('trainer:powerTarget', v => sent.push(v), {signal: abort.signal});
    });

    afterEach(() => { pm.stop(); abort.abort(); jest.useRealTimers(); });

    function ride(seconds, trainer, meter) {
        for(let i = 0; i < seconds; i++) {
            clock += 1000;
            jest.advanceTimersByTime(1000);
            xf.dispatch('ble:controllable:power', typeof trainer === 'function' ? trainer() : trainer);
            xf.dispatch('ble:powerMeter:power', typeof meter === 'function' ? meter() : meter);
        }
    }

    test('the spin-up mismatch after a step teaches nothing, and the step up arrives over 5 s', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter'}});
        xf.dispatch('db:watchStatus', {watchStatus: 'started'});
        xf.dispatch('db:powerTarget', {powerTarget: 200});
        ride(120, 208, 200);                         // pedals 4% under the trainer
        const ratio = pm.core.ratio();
        expect(ratio).toBeCloseTo(0.9615, 3);

        const before = sent[sent.length - 1];
        const goal = pm.core.adjust(300);
        sent.length = 0;
        xf.dispatch('db:powerTarget', {powerTarget: 300});
        expect(sent[0]).toBe(before);                // starts from where the trainer was
        // the first 12 s: the rider spinning up, the pedals 25% under the trainer
        ride(12, 312, 234);
        expect(pm.core.ratio()).toBeCloseTo(ratio, 6);   // held
        expect(pm.snapshot().hold).toBe(true);
        const up = sent.slice(0, 6);
        up.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(up[i]));   // rising every second
        expect(up[5]).toBe(goal);                    // at 300 / ratio after 5 s
        expect(Math.max(...sent)).toBe(goal);        // and no correction chased the mismatch
        ride(10, 312, 300);
        expect(pm.snapshot().hold).toBe(false);
    });

    test('a step down lands at once, still with the hold', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter'}});
        xf.dispatch('db:watchStatus', {watchStatus: 'started'});
        xf.dispatch('db:powerTarget', {powerTarget: 300});
        ride(120, 300, 300);
        sent.length = 0;
        xf.dispatch('db:powerTarget', {powerTarget: 150});
        expect(sent[0]).toBe(150);
        expect(pm.snapshot().hold).toBe(true);
    });

    test('a small change (a ramp step or a +5) does not hold', () => {
        xf.dispatch('db:sources', {sources: {power: 'ble:powerMeter'}});
        xf.dispatch('db:watchStatus', {watchStatus: 'started'});
        xf.dispatch('db:powerTarget', {powerTarget: 250});
        ride(60, 250, 250);
        xf.dispatch('db:powerTarget', {powerTarget: 255});
        expect(pm.snapshot().hold).toBe(false);
    });
});
