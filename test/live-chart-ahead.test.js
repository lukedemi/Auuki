/**
 * @jest-environment jsdom
 */
import { ahead, nextChange, FUTURE } from '../src/views/live-chart.js';

// 2 x (60 s at 120%, 30 s at 50%), then a stair of a ramp, then a SIM step
const workout = {intervals: [
    {steps: [{duration: 300, power: 0.6}]},
    {steps: [{duration: 60, power: 1.2}, {duration: 30, power: 0.5}]},
    {steps: [{duration: 60, power: 1.2}, {duration: 30, power: 0.5}]},
    {steps: [{duration: 10, power: 0.5}, {duration: 10, power: 0.55}, {duration: 10, power: 0.6}]},
    {steps: [{duration: 60, slope: 2}]},
]};
const base = {workout, ftp: 250, intensity: 100};

describe('the live chart looks ahead', () => {
    test('a third of a fixed window is the future', () => {
        expect(FUTURE).toBeCloseTo(1 / 3);
    });

    test('30 s left in the warm-up: the next interval comes in at 0:30', () => {
        const b = ahead({...base, iv: 0, st: 0, stepLeft: 30, target: 150, seconds: 200});
        expect(b[0]).toEqual({from: 0, to: 30, w: 150});
        expect(b[1]).toEqual({from: 30, to: 90, w: 300});
        expect(b[2]).toEqual({from: 90, to: 120, w: 125});
        expect(b[3]).toEqual({from: 120, to: 180, w: 300});
        expect(b[4]).toEqual({from: 180, to: 200, w: 125});      // clipped to the window
        expect(nextChange(b)).toEqual({from: 30, w: 300});
    });

    test('the step running keeps its live target (a nudge); later steps follow the workout %', () => {
        const b = ahead({...base, intensity: 90, iv: 1, st: 0, stepLeft: 20, target: 310, seconds: 60});
        expect(b[0]).toEqual({from: 0, to: 20, w: 310});
        expect(b[1]).toEqual({from: 20, to: 50, w: 113});        // 125 x 90%
        expect(b[2].w).toBe(270);                                 // 300 x 90%
    });

    test('a ramp stays a stair, and a SIM step is a gap that ends the forecast', () => {
        const b = ahead({...base, iv: 2, st: 1, stepLeft: 5, target: 125, seconds: 600});
        // 125 for 5 s merges with the stair's first 125 W step
        expect(b[0]).toEqual({from: 0, to: 15, w: 125});
        expect(b[1]).toEqual({from: 15, to: 25, w: 138});
        expect(b[2]).toEqual({from: 25, to: 35, w: 150});
        expect(b).toHaveLength(3);
        expect(nextChange(b)).toEqual({from: 15, w: 138});
        // on the last stair step, the next change is to free riding
        expect(nextChange(ahead({...base, iv: 3, st: 2, stepLeft: 4, target: 150, seconds: 600}))).toEqual({from: 4, w: 0});
    });

    test('nothing loaded, nothing ahead', () => {
        expect(ahead({...base, workout: null, iv: 0, st: 0, stepLeft: 10, target: 100, seconds: 60})).toEqual([]);
        expect(nextChange([])).toBe(null);
    });
});

import { powerTop, hrRange } from '../src/views/live-chart.js';

// Nov 26, 2026: "pick an axis and stick with it"
describe('the live chart keeps one axis for the ride', () => {
    const ftp = 250;
    const threshold = {intervals: [{steps: [{duration: 600, power: 0.6}]}, {steps: [{duration: 720, power: 1.0}]}, {steps: [{duration: 300, power: 0.5}]}]};
    test('the hardest target plus 15%, whatever the window holds', () => {
        expect(powerTop({workout: threshold, ftp})).toBe(288);            // 250 x 1.15
    });
    test('an easy workout still shows FTP', () => {
        expect(powerTop({workout: {intervals: [{steps: [{duration: 3600, power: 0.65}]}]}, ftp})).toBe(275);
    });
    test('the workout % moves it; a free ride gets 150%; the ramp test tops out at 250%', () => {
        expect(powerTop({workout: threshold, ftp, intensity: 110})).toBe(316);
        expect(powerTop({workout: null, ftp})).toBe(375);
        expect(powerTop({workout: {intervals: [{steps: [{duration: 60, power: 2.0}]}]}, ftp})).toBe(575);
        expect(powerTop({workout: {intervals: [{steps: [{duration: 60, power: 3.0}]}]}, ftp})).toBe(625);
    });
    test('heart rate: 80 to 190, widened and never narrowed', () => {
        expect(hrRange([120, 150])).toEqual([80, 190]);
        expect(hrRange([75, 192])).toEqual([70, 197]);
        expect(hrRange([130], [70, 197])).toEqual([70, 197]);
    });
});
