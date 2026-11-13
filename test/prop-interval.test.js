/**
 * @jest-environment jsdom
 */

import { xf } from '../src/functions.js';
import { models } from '../src/models/models.js';

describe('power1s when the sensors go quiet', () => {
    test('holds through one silent second, reads 0 after two, and every second after', () => {
        jest.useFakeTimers();
        const got = [];
        const abort = new AbortController();
        xf.sub('power1s', (v) => got.push(v), {signal: abort.signal});
        const p = models.power1s;
        p.stop(); p.reset(); p.silent = 0; p.state = 0; p.start();

        xf.dispatch('db:power', {power: 200});
        jest.advanceTimersByTime(1000);     // 200
        jest.advanceTimersByTime(1000);     // silent 1: nothing
        jest.advanceTimersByTime(1000);     // silent 2: 0
        jest.advanceTimersByTime(1000);     // 0 again
        xf.dispatch('db:power', {power: 150});
        jest.advanceTimersByTime(1000);     // 150
        expect(got).toEqual([200, 0, 0, 150]);

        abort.abort();
        jest.useRealTimers();
    });
});
