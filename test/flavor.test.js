/**
 * @jest-environment jsdom
 */

import { readFlavor } from '../src/flavor.js';

const page = (content) => {
    const doc = document.implementation.createHTMLDocument('x');
    if(content) { const m = doc.createElement('meta'); m.name = 'ergatory-flavor'; m.content = content; doc.head.appendChild(m); }
    return doc;
};

describe('the two ERGatory builds', () => {
    test('the page says which; anything else is the household build', () => {
        expect(readFlavor(page('public'))).toBe('public');
        expect(readFlavor(page('home'))).toBe('home');
        expect(readFlavor(page(null))).toBe('home');
        expect(readFlavor(null)).toBe('home');
    });
    test('the household build has the room and the traces', () => {
        const { flags, APP_NAME } = require('../src/flavor.js');
        expect(flags).toEqual({room: true, traces: true, strava: false});
        expect(APP_NAME).toBe('ERGatory');
    });
});
