/**
 * @jest-environment jsdom
 */

import { templateOf, fitSize, groupRows, reserve } from '../src/views/fit-text.js';

describe('numbers as big as their tiles', () => {
    test('the width is measured with every digit as 0, so a ticking clock does not resize', () => {
        expect(templateOf(' 01:55 ')).toBe('00:00');
        expect(templateOf('18:42')).toBe(templateOf('01:55'));
        expect(templateOf('6:21 PM')).toBe('0:00 PM');
    });
    test('heart rate going 99 to 100 changes nothing: a plain number is at least three digits', () => {
        expect(templateOf('99')).toBe('000');
        expect(templateOf('100')).toBe('000');
        expect(templateOf('8')).toBe('000');
        expect(templateOf('--')).toBe('000');
        expect(templateOf('')).toBe('000');
        expect(templateOf('1040')).toBe('0000');
    });
    test('a value only ever widens what it reserves', () => {
        const store = new Map(), el = {};
        expect(reserve(el, 150, store)).toBe(150);
        expect(reserve(el, 200, store)).toBe(200);    // kJ passes 999
        expect(reserve(el, 150, store)).toBe(200);    // and keeps the room
    });
    test('the size is the largest that fits the width and the height', () => {
        // 300 x 200 tile, text 150 px wide at 100 px: width allows 184, height 184
        expect(fitSize({width: 300, height: 200, textWidth100: 150})).toBe(184);
        // a long clock in the same tile: the width decides
        expect(fitSize({width: 300, height: 200, textWidth100: 450})).toBe(61);
        expect(fitSize({width: 0, height: 200, textWidth100: 100})).toBe(null);
    });
    test('tiles side by side are one row; the Lap section rows are their own', () => {
        const rows = groupRows([
            {mid: 100, scope: 'main', size: 120}, {mid: 104, scope: 'main', size: 90},
            {mid: 300, scope: 'main', size: 60},
            {mid: 302, scope: 'lap', size: 80},
        ]);
        expect(rows.map((r) => r.items.length)).toEqual([2, 1, 1]);
    });
});

describe('a value keeps the size it was given', () => {
    test('a power reading sets its colour, never its whole style (it wiped the fitted size)', () => {
        require('../src/views/data-views.js');
        const { xf } = require('../src/functions.js');
        const el = document.createElement('power-value');
        el.setAttribute('prop', 'db:power');
        document.body.appendChild(el);
        el.style.fontSize = '115px';
        xf.dispatch('db:power', {power: 245});
        expect(el.textContent).toBe('245');
        expect(el.style.fontSize).toBe('115px');
        expect(el.style.color).not.toBe('');
        el.remove();
    });
});
