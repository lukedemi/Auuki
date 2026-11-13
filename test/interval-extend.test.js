/**
 * @jest-environment jsdom
 */

const v8 = require('node:v8');
global.structuredClone = global.structuredClone ?? ((v) => v8.deserialize(v8.serialize(v)));
const { extendInterval } = require('../src/workouts/extend.js');

const workout = () => ({
    meta: {name: 'Z2', duration: 3600},
    intervals: [
        {duration: 600, steps: [{duration: 600, power: 0.6}]},
        {duration: 2400, steps: [{duration: 2400, power: 0.7}]},
        // a cool-down ramp as Auuki stores it: 10 s steps
        {duration: 600, steps: Array.from({length: 60}, (_, k) => ({duration: 10, power: 0.6 - k * 0.002}))},
    ],
});

describe('more time on an interval', () => {
    test('a steady interval gets 5 minutes, and so does the workout', () => {
        const w = workout();
        const res = extendInterval(w, 1, 300);
        expect(res.workout.intervals[1].duration).toBe(2700);
        expect(res.workout.intervals[1].steps[0].duration).toBe(2700);
        expect(res.workout.meta.duration).toBe(3900);
        expect(res.last).toBe(0);
    });
    test('a ramp finishes and then holds its last power', () => {
        const res = extendInterval(workout(), 2, 300);
        const steps = res.workout.intervals[2].steps;
        expect(steps[58].duration).toBe(10);
        expect(steps[59].duration).toBe(310);
        expect(res.workout.intervals[2].duration).toBe(900);
    });
    test('the original workout is untouched; twice is ten minutes', () => {
        const w = workout();
        const once = extendInterval(w, 1, 300).workout;
        const twice = extendInterval(once, 1, 300).workout;
        expect(w.intervals[1].duration).toBe(2400);
        expect(twice.intervals[1].duration).toBe(3000);
    });
    test('nothing to extend: no such interval, or one measured in distance', () => {
        expect(extendInterval(workout(), 9, 300)).toBe(null);
        expect(extendInterval({intervals: [{distance: 1000, steps: [{distance: 1000}]}]}, 0, 300)).toBe(null);
    });
});
