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
        expect(core(lib['Sweet Spot 3×15 min'])).toBe('3 × 15 min at 90% · 5 min easy');       // the warm-up's openers are not the workout
        expect(core(lib['Threshold 2×20 min'])).toBe('2 × 20 min at 97% · 10 min easy');
        expect(core(lib['VO2 Max 30/15 s · 3×13'])).toBe('3 sets of 13 × 30 s at 125% · 15 s easy');
        expect(core(lib['Anaerobic 8×15 s sprints'])).toBe('8 × 15 s at 200% · 4 min easy');          // nor beside sprints
        expect(core(lib['Over-Unders 3×9 min'])).toBe('3 × 9 min over-unders 95–105% · 5 min easy');
        expect(core(lib['Over-Unders 2×15 min · 30 s surges'])).toBe('2 × 15 min over-unders 90–110% · 8 min easy');
        expect(core(lib['VO2 Max pyramid 1–4 min'])).toBe('pyramid 1-2-3-4-3-2-1 min at 120%');
        expect(core(lib['Endurance 90 min'])).toBe('1 h 30 steady at 68%');                    // the warm-up ramp is not the ride
        expect(core(lib['Recovery 45 min'])).toBe('45 min steady at 50%');
        expect(core(lib['Test · lactate steps 9×4 min'])).toBe('9 × 4 min steps, 55 → 111%');
        expect(core(lib['Test · ramp 1 min steps'])).toBe('21 × 1 min steps, 50 → 150%');
    });

    test('details add the warm-up, the cool-down and the watts at an FTP', () => {
        expect(details(lib['Sweet Spot 3×15 min'], undefined, 295)).toBe('10 min warm-up, 3 × 15 min at 90% (266 W) with 5 min easy between, 10 min cool-down.');
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

describe('the library', () => {
    test('every workout has the same ends and a name in the scheme', () => {
        const names = Object.keys(lib);
        expect(names.length).toBeGreaterThanOrEqual(45);
        expect(new Set(names).size).toBe(names.length);
        for(const [name, w] of Object.entries(lib)) {
            const steps = w.intervals.flatMap((iv) => iv.steps);
            expect(steps[0].power).toBeCloseTo(0.45, 1);                     // every warm-up starts at 45%
            expect(steps[steps.length - 1].power).toBeLessThanOrEqual(0.45);  // every cool-down ends easy
            expect(w.meta.author).toBe('infERGno');
            expect(w.meta.description.length).toBeGreaterThan(20);
            // "<Type> <main set>", the type being the workout's own category
            expect(name.startsWith(`${w.meta.category} `)).toBe(true);
            expect(name).toMatch(/\d/);                                         // says how much
            expect(name).toMatch(/ (min|s)\b| s · /);                           // with its units
        }
    });
    test('steady rides are named by their minutes', () => {
        for(const [name, w] of Object.entries(lib)) {
            const mm = /^(Recovery|Endurance) (\d+) min$/.exec(name);
            if(!mm) continue;
            const sec = w.intervals.flatMap((iv) => iv.steps).reduce((a, s) => a + s.duration, 0);
            expect(Math.round(sec / 60)).toBe(Number(mm[2]));
        }
    });
});
