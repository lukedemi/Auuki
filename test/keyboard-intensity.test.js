/**
 * @jest-environment jsdom
 */

globalThis.__AUUKI_NO_TRACE__ = true;
const { xf } = require('../src/functions.js');
require('../src/views/keyboard.js');

describe('arrow keys in ERG', () => {
    const got = [];
    beforeAll(() => {
        for(const t of ['ui:intensity-inc', 'ui:intensity-dec', 'ui:power-target-inc', 'ui:power-target-dec', 'ui:mode-set']) {
            xf.sub(t, () => got.push(t));
        }
        xf.dispatch('db:mode', {mode: 'erg'});
    });
    const key = (code, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', {code, ...opts}));

    test('Up / Down move the Workout %', () => {
        got.length = 0;
        key('ArrowUp'); key('ArrowDown');
        expect(got).toEqual(['ui:intensity-inc', 'ui:intensity-dec']);
    });
    test('Shift + Up / Down move the ERG target', () => {
        got.length = 0;
        key('ArrowUp', {shiftKey: true}); key('ArrowDown', {shiftKey: true});
        expect(got).toEqual(['ui:power-target-inc', 'ui:power-target-dec']);
    });
    test('R and S do nothing while the extra modes are off', () => {
        got.length = 0;
        document.documentElement.classList.add('erg-only');
        key('KeyR'); key('KeyS');
        expect(got).toEqual([]);
        document.documentElement.classList.remove('erg-only');
        key('KeyR');
        expect(got).toEqual(['ui:mode-set']);
    });
});
