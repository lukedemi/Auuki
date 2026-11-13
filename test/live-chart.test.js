/**
 * @jest-environment jsdom
 */

import { xf } from '../src/functions.js';
import { LiveSamples } from '../src/live-samples.js';
import { smooth, bucket, windowStats } from '../src/views/live-chart.js';

describe('LiveSamples', () => {
    test('one row a second from the latest power, HR and target', () => {
        const ls = LiveSamples();
        ls.start();
        xf.dispatch('db:power1s', {power1s: 250});
        xf.dispatch('db:heartRate', {heartRate: 140});
        xf.dispatch('db:powerTarget', {powerTarget: 260});
        xf.dispatch('watch:elapsed', 1);
        xf.dispatch('watch:elapsed', 1);     // the same second twice
        xf.dispatch('db:power1s', {power1s: 255});
        xf.dispatch('watch:elapsed', 2);
        expect(ls.all()).toEqual([
            {t: 1, w: 250, hr: 140, target: 260, bal: null},
            {t: 2, w: 255, hr: 140, target: 260, bal: null},
        ]);
    });

    test('stopping (elapsed 0) keeps the ride; the next ride starts fresh', () => {
        const ls = LiveSamples();
        ls.onElapsed(1); ls.onElapsed(2); ls.onElapsed(3);
        ls.onElapsed(0);
        expect(ls.all().length).toBe(3);
        ls.onElapsed(1);
        expect(ls.all().map(r => r.t)).toEqual([1]);
    });
});

describe('live chart arithmetic', () => {
    test('smooth is a running mean over n samples', () => {
        expect(smooth([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
    });

    test('bucket keeps at most cols points, each a bucket mean at its last t', () => {
        const rows = Array.from({length: 10}, (_, i) => ({t: i + 1, w: i < 5 ? 100 : 200}));
        expect(bucket(rows, 2, r => r.w)).toEqual([[5, 100], [10, 200]]);
        expect(bucket(rows.slice(0, 3), 10, r => r.w).length).toBe(3);
    });

    test('window stats: mean power, mean HR over the samples that have one', () => {
        expect(windowStats([{w: 200, hr: 0}, {w: 300, hr: 150}])).toEqual({w: 250, hr: 150, bal: null});
        expect(windowStats([])).toEqual({w: null, hr: null, bal: null});
    });

    test('window balance is weighted by power and leaves out coasting', () => {
        const rows = [{w: 300, hr: 150, bal: 48}, {w: 100, hr: 150, bal: 52}, {w: 0, hr: 150, bal: 80}];
        expect(windowStats(rows).bal).toBe(49);   // (48 x 300 + 52 x 100) / 400
    });
});
