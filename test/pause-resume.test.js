import { pedallingThroughPause, RESUME_GRACE_S, RESUME_AFTER_S } from '../src/pause-resume.js';

// the watch's count (watch.js onPower1s): RESUME_AFTER_S readings in a row resume
function replay(readings, pausedAt = 0) {
    let n = 0;
    for(const [t, power, cadence] of readings) {
        if(pedallingThroughPause({power, cadence, pausedAt, now: t * 1000})) {
            if(++n >= RESUME_AFTER_S) return t;
        } else n = 0;
    }
    return null;
}

describe('pedalling ends a pause you set', () => {
    test('Nov 17, 13:50:34: the pedals\' held readings after a stop do not resume the ride', () => {
        // paused at 0; the pedals still reporting what they last measured, then nothing
        const held = [[1, 118, 80], [2, 118, 80], [3, 93, 79], [4, 93, 79], [5, 0, 0], [6, 0, 0], [7, 0, 0], [8, 0, 0], [9, 0, 0], [10, 0, 0], [11, 0, 0]];
        expect(replay(held)).toBe(null);
    });
    test('the first seconds of a pause never count, however hard', () => {
        for(let t = 0; t < RESUME_GRACE_S; t++) expect(pedallingThroughPause({power: 300, cadence: 95, pausedAt: 0, now: t * 1000})).toBe(false);
    });
    test('feet drifting: watts on the 100 W hold but no cadence to speak of', () => {
        const drift = Array.from({length: 20}, (_, i) => [i + 1, 85, 18]);
        expect(replay(drift)).toBe(null);
    });
    test('pedalling for real after the grace resumes after five seconds of it', () => {
        const ride = Array.from({length: 20}, (_, i) => [i + 1, 120, 85]);
        expect(replay(ride)).toBe(RESUME_GRACE_S + RESUME_AFTER_S - 1);
    });
});
