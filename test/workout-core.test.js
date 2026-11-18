/**
 * @jest-environment jsdom
 */
import { workouts } from '../src/workouts/workouts.js';
import { zwo } from '../src/workouts/zwo.js';
import { core, details, dur } from '../src/workout-core.js';

const lib = Object.fromEntries(workouts.map((x) => { const w = zwo.readToInterval(x); return [w.meta.name, w]; }));
const iv = (segs) => ({intervals: segs.map(([m, p]) => ({steps: [{duration: m * 60, power: p}]}))});

describe('the core of a workout, from its steps', () => {
    test('the library reads the way a rider would say it', () => {
        expect(core(lib['Dijon'])).toBe('2 sets of 8 × 1 min at 121% · 1 min easy');    // its 2 × 30 s openers are not the workout
        expect(core(lib['Chili Pepper'])).toBe('2 sets of 6 × 40 s at 121% · 20 s easy');
        expect(core(lib['Pasta'])).toBe('2 × 20 min at 98% · 10 min easy');
        expect(core(lib['Maple'])).toBe('4 × 10 min at 92% · 5 min easy');
        expect(core(lib['Honey'])).toBe('3 × 15 min at 90% · 5 min easy');              // nor are Honey's 30 s openers
        expect(core(lib['Quiche'])).toBe('3 × 4 min over-unders 90–105% · 4 min easy');
        expect(core(lib['Baguette +1'])).toBe('2 h at 63–71%');                           // the warm-up is not the ride
        expect(core(lib['Ramp Test'])).toMatch(/^\d+ min ramp \d+–\d+%$/);
    });

    test('details add the warm-up, the cool-down and the watts at an FTP', () => {
        expect(details(lib['Dijon'], undefined, 295)).toBe('10 min warm-up, 2 sets of 8 × 1 min at 121% (357 W) with 1 min easy between, 11 min cool-down.');
        expect(details(iv([[10, .55], [100, .7], [10, .55]]), undefined, 200)).toBe('2 h steady at 70% of FTP (140 W).');   // its 55% ends are the warm-up and cool-down
        expect(details(iv([[10, .5], [50, .63], [50, .71], [10, .5]]), undefined, 200)).toBe('2 h at 63–71% of FTP (126–142 W).');
        expect(details(iv([[60, .5]]), undefined, 200)).toBe('60 min steady at 50% of FTP (100 W).');
    });

    test('nothing to say about a workout without power', () => {
        expect(core({intervals: [{steps: [{duration: 600, slope: 3}]}]})).toBe('');
        expect(core({})).toBe('');
    });

    test('durations', () => {
        expect(dur(40)).toBe('40 s');
        expect(dur(60)).toBe('1 min');
        expect(dur(90 * 60)).toBe('1 h 30');
        expect(dur(120 * 60)).toBe('2 h');
    });
});
