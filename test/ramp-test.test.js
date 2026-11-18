/**
 * @jest-environment jsdom
 */
import { xf } from '../src/functions.js';
import { workouts, RAMP_TEST } from '../src/workouts/workouts.js';
import { zwo } from '../src/workouts/zwo.js';
import { bestAverage, FailureWatch, rampIntervals, isRampTest } from '../src/ramp-test.js';

const ramp = zwo.readToInterval(workouts.find((x) => x.includes(`<name>${RAMP_TEST}</name>`)));

describe('the ramp test', () => {
    test('the workout: a warm-up, 31 one-minute steps from 50% to 200%, the cool-down last', () => {
        expect(isRampTest(ramp)).toBe(true);
        const r = rampIntervals(ramp);
        expect(r.last - r.first + 1).toBe(31);
        expect(ramp.intervals[r.first].steps[0].power).toBeCloseTo(0.5);
        expect(ramp.intervals[r.last].steps[0].power).toBeCloseTo(2.0);
        expect(r.cooldown).toBe(ramp.intervals.length - 1);
        expect(r.cooldown).toBe(r.last + 1);
    });

    test('the best minute', () => {
        expect(bestAverage(Array(59).fill(300))).toBe(0);                   // not a minute yet
        expect(bestAverage([...Array(60).fill(200), ...Array(60).fill(400), ...Array(30).fill(100)])).toBe(400);
        expect(bestAverage([...Array(30).fill(300), ...Array(30).fill(500)])).toBe(400);
    });

    test('failure: cadence gone for 8 s, or power under 70% of the step for 10 s', () => {
        let w = FailureWatch();
        for(let i = 0; i < 7; i++) expect(w.tick({cadence: 40, power: 300, target: 300})).toBe(false);
        expect(w.tick({cadence: 40, power: 300, target: 300})).toBe(true);
        w = FailureWatch();
        for(let i = 0; i < 9; i++) expect(w.tick({cadence: 90, power: 150, target: 300})).toBe(false);
        expect(w.tick({cadence: 90, power: 150, target: 300})).toBe(true);
        w = FailureWatch();                                                   // a dip that recovers is not failure
        for(let i = 0; i < 6; i++) w.tick({cadence: 45, power: 300, target: 300});
        w.tick({cadence: 85, power: 300, target: 300});
        for(let i = 0; i < 6; i++) expect(w.tick({cadence: 45, power: 300, target: 300})).toBe(false);
        w = FailureWatch();                                                   // no cadence sensor: power alone decides
        for(let i = 0; i < 20; i++) expect(w.tick({cadence: 0, power: 300, target: 300})).toBe(false);
    });

    test('ridden through the app: it watches the ramp, ends it on failure, jumps to the cool-down and reports', () => {
        // the module's own instance is the one riding (imports run first);
        // db: events carry the whole change, the subscriber reads its own prop
        const jumps = [], results = [];
        xf.sub('ui:watchJump', (i) => jumps.push(i));
        xf.sub('ramp-test:result', (r) => results.push(r));
        const r = rampIntervals(ramp);
        xf.dispatch('db:workout', {workout: ramp});
        xf.dispatch('db:ftp', {ftp: 300});
        xf.dispatch('db:watchStatus', {watchStatus: 'started'});
        // ten steps, each a minute at its target, cadence 90
        for(let step = 0; step < 10; step++) {
            xf.dispatch('db:intervalIndex', {intervalIndex: r.first + step});
            const target = 300 * (0.5 + step * 0.05);
            xf.dispatch('db:powerTarget', {powerTarget: target});
            for(let s = 0; s < 60; s++) { xf.dispatch('db:power', {power: target}); xf.dispatch('db:cadence', {cadence: 90}); xf.dispatch('watch:elapsed', 0); }
        }
        // step 11: the legs go
        xf.dispatch('db:intervalIndex', {intervalIndex: r.first + 10});
        xf.dispatch('db:powerTarget', {powerTarget: 300});
        for(let s = 0; s < 20; s++) { xf.dispatch('db:power', {power: 300}); xf.dispatch('db:cadence', {cadence: 30}); xf.dispatch('watch:elapsed', 0); }
        expect(jumps).toEqual([r.cooldown]);
        expect(results.length).toBe(1);
        expect(results[0].why).toBe('failed');
        expect(results[0].steps).toBe(11);
        // the best minute: 52 s of step 10 (285 W) and the 8 s at 300 W before failure was called
        expect(results[0].best).toBe(Math.round((52 * 285 + 8 * 300) / 60));
        expect(results[0].ftp).toBe(Math.round(287 * 0.75));
        expect(results[0].current).toBe(300);
    });
});
