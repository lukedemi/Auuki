import { timeline, positionAt, positionKey, LOBBY_S } from '../../src/group/schedule.js';

// warm-up 120 s; 2 × (60 s on, 30 s off) as two intervals of two steps; 60 s cool-down
const workout = {
    intervals: [
        {duration: 120, steps: [{duration: 120, power: 0.5}]},
        {duration: 90,  steps: [{duration: 60, power: 1.2}, {duration: 30, power: 0.5}]},
        {duration: 90,  steps: [{duration: 60, power: 1.2}, {duration: 30, power: 0.5}]},
        {duration: 60,  steps: [{duration: 60, power: 0.4}]},
    ],
};
const startAt = Date.UTC(2026, 10, 18, 12, 0, 0);
const at = (s) => startAt + s * 1000;
const schedule = {startAt, lobbyS: LOBBY_S, timeline: timeline(workout)};

describe('timeline', () => {
    test('lays every step end to end', () => {
        const tl = timeline(workout);
        expect(tl.durationS).toBe(360);
        expect(tl.steps.map(s => s.start)).toEqual([0, 120, 180, 210, 270, 300]);
        expect(tl.intervals).toEqual([{start: 0, dur: 120}, {start: 120, dur: 90}, {start: 210, dur: 90}, {start: 300, dur: 60}]);
    });
    test('refuses a distance step or an empty workout', () => {
        expect(() => timeline({intervals: [{steps: [{distance: 1000}]}]})).toThrow(/duration/);
        expect(() => timeline({intervals: []})).toThrow(/no steps/);
        expect(() => timeline({intervals: [{steps: []}]})).toThrow(/no steps/);
    });
});

describe('positionAt', () => {
    test('before the lobby opens', () => {
        expect(positionAt(schedule, at(-LOBBY_S - 30))).toEqual({phase: 'closed', opensIn: 30});
    });
    test('warmup counts down to the start', () => {
        expect(positionAt(schedule, at(-LOBBY_S))).toEqual({phase: 'warmup', startsIn: LOBBY_S});
        expect(positionAt(schedule, at(-0.2))).toEqual({phase: 'warmup', startsIn: 1});
    });
    test('the first second of the workout', () => {
        expect(positionAt(schedule, at(0))).toMatchObject({phase: 'workout', second: 0, intervalIndex: 0, stepIndex: 0, stepLeft: 120, intervalLeft: 120, workoutLeft: 360});
    });
    test('counts like the watch: 60 … 1, then the next step', () => {
        expect(positionAt(schedule, at(120))).toMatchObject({intervalIndex: 1, stepIndex: 0, stepLeft: 60, intervalLeft: 90});
        expect(positionAt(schedule, at(179.999))).toMatchObject({intervalIndex: 1, stepIndex: 0, stepLeft: 1, intervalLeft: 31});
        expect(positionAt(schedule, at(180))).toMatchObject({intervalIndex: 1, stepIndex: 1, stepLeft: 30, intervalLeft: 30, stepDuration: 30, intervalDuration: 90});
    });
    test('a late join lands where everyone else is', () => {
        expect(positionAt(schedule, at(250.5))).toMatchObject({intervalIndex: 2, stepIndex: 0, stepLeft: 20, intervalLeft: 50});
    });
    test('the last second, then cooldown', () => {
        expect(positionAt(schedule, at(359.9))).toMatchObject({phase: 'workout', intervalIndex: 3, stepLeft: 1, workoutLeft: 1});
        expect(positionAt(schedule, at(360))).toEqual({phase: 'cooldown', since: 0});
        expect(positionAt(schedule, at(4000))).toEqual({phase: 'cooldown', since: 3640});
    });
    test('two riders 40 ms apart in clock agree except right on the boundary', () => {
        for(let s = 0; s < 360; s += 0.25) {
            const a = positionAt(schedule, at(s));
            const b = positionAt(schedule, at(s) + 40);
            const nearBoundary = (s % 1) > 0.95 || (s % 1) === 0;
            if(!nearBoundary) expect(positionKey(a)).toBe(positionKey(b));
        }
    });
    test('positionKey changes once a second', () => {
        expect(positionKey(positionAt(schedule, at(10.1)))).toBe(positionKey(positionAt(schedule, at(10.9))));
        expect(positionKey(positionAt(schedule, at(10.9)))).not.toBe(positionKey(positionAt(schedule, at(11))));
    });
});
