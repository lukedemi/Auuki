/**
 * @jest-environment jsdom
 */

import { remainingSeconds, clockAt } from '../src/views/time-left.js';

const intervals = [{duration: 600}, {duration: 300}, {duration: 1200}, {duration: 300}];

describe('time left', () => {
    test('before the workout starts it is the whole workout', () => {
        expect(remainingSeconds({intervals, workoutStatus: 'stopped'})).toBe(2400);
    });
    test('running: the rest of this interval plus everything after', () => {
        expect(remainingSeconds({intervals, index: 1, lapTime: 120, workoutStatus: 'started'})).toBe(120 + 1200 + 300);
        expect(remainingSeconds({intervals, index: 3, lapTime: 5, workoutStatus: 'started'})).toBe(5);
    });
    test('done is 0; no workout, or one without durations, is unknown', () => {
        expect(remainingSeconds({intervals, workoutStatus: 'done'})).toBe(0);
        expect(remainingSeconds({intervals: []})).toBe(null);
        expect(remainingSeconds({intervals: [{distance: 1000}]})).toBe(null);
    });
    test('finish is a clock time', () => {
        expect(clockAt(Date.UTC(2026, 10, 13, 22, 10))).toMatch(/^\d{1,2}:10 (AM|PM)$/);
    });
});

import { totalKj } from '../src/views/time-left.js';

describe('total kJ', () => {
    test('one sample a second: watts summed over seconds, in kJ', () => {
        expect(totalKj(Array.from({length: 3600}, () => ({w: 250})))).toBe(900);
        expect(totalKj([])).toBe(0);
    });
});
