/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import { PowerMatchCore, PowerMatch } from '../src/power-match.js';

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
});
