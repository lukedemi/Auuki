/**
 * @jest-environment jsdom
 */

const v8 = require('node:v8');
global.structuredClone = global.structuredClone ?? ((v) => v8.deserialize(v8.serialize(v)));
require('fake-indexeddb/auto');
globalThis.__AUUKI_NO_TRACE__ = true;

const { xf } = require('../src/functions.js');
const { models } = require('../src/models/models.js');
require('../src/db.js');

const seen = {};
xf.sub('db:powerTarget', (v) => seen.powerTarget = v);
xf.sub('db:intensity', (v) => seen.intensity = v);

describe('the power target and the workout intensity', () => {
    test('the target moves 5 W a press', () => {
        xf.dispatch('ui:power-target-set', 250);
        xf.dispatch('ui:power-target-inc');
        expect(seen.powerTarget).toBe(255);
        xf.dispatch('ui:power-target-dec');
        xf.dispatch('ui:power-target-dec');
        expect(seen.powerTarget).toBe(245);
    });

    test('intensity rescales the current target and keeps a nudge', () => {
        xf.dispatch('ui:power-target-set', 286);
        xf.dispatch('ui:intensity-set', 95);
        expect(seen.intensity).toBe(95);
        expect(seen.powerTarget).toBe(272);           // 286 × 0.95
        xf.dispatch('ui:power-target-inc');          // a +5 on this interval
        expect(seen.powerTarget).toBe(277);
        xf.dispatch('ui:intensity-set', 100);
        expect(seen.powerTarget).toBe(292);           // the nudge carried: 277 / 0.95
        xf.dispatch('ui:intensity-inc');
        expect(seen.intensity).toBe(101);
    });

    test('intensity stays between 50 and 150', () => {
        xf.dispatch('ui:intensity-set', 400);
        expect(seen.intensity).toBe(150);
        xf.dispatch('ui:intensity-set', 10);
        expect(seen.intensity).toBe(50);
        xf.dispatch('ui:intensity-set', 100);
    });

    test('the volume starts at 50, not muted', () => {
        expect(models.volume.defaultValue()).toBe(50);
    });
});
