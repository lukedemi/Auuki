/**
 * @jest-environment jsdom
 */

globalThis.__AUUKI_NO_AUTOUPLOAD__ = true;
const v8 = require('node:v8');
global.structuredClone = global.structuredClone ?? ((v) => v8.deserialize(v8.serialize(v)));
require('fake-indexeddb/auto');
import { xf } from '../src/functions.js';
import { idb } from '../src/storage/idb.js';
import { models } from '../src/models/models.js';
import { due, AutoUpload, MIN_S, BACKOFF_S } from '../src/auto-upload.js';
import '../src/views/activity-history.js';

const NOW = Date.UTC(2026, 10, 17, 14, 30);
const ride = (o = {}) => Object.assign({id: 'a', name: 'Ride', timestamp: NOW - 3600e3, duration: 3600, status: {intervals: 'none'}}, o);

describe('which rides go to intervals.icu by themselves', () => {
    test('not yet there, 5 min or more, from the last 3 days', () => {
        expect(due(ride(), NOW)).toBe(true);
        expect(due(ride({status: {intervals: 'success'}}), NOW)).toBe(false);
        expect(due(ride({status: {intervals: 'fail'}}), NOW)).toBe(true);
        expect(due(ride({duration: MIN_S - 1}), NOW)).toBe(false);     // a start and an instant stop
        expect(due(ride({timestamp: NOW - 4 * 86400e3}), NOW)).toBe(false);
    });

    test('a failure backs off, a success stops it; nothing without the key', async () => {
        let t = NOW;
        const results = [':fail', ':fail', ':success'];
        const calls = [];
        const au = AutoUpload({now: () => t, configured: () => true, upload: async (id) => { calls.push(id); return results.shift(); }});
        au.set([ride(), ride({id: 'short', duration: 30})]);
        expect(await au.sweep()).toEqual([['a', ':fail']]);
        expect(await au.sweep()).toEqual([]);                       // waiting out the first back-off
        t += BACKOFF_S[0] * 1000;
        expect(await au.sweep()).toEqual([['a', ':fail']]);
        t += BACKOFF_S[0] * 1000;
        expect(await au.sweep()).toEqual([]);                       // the second is longer
        t += BACKOFF_S[1] * 1000;
        expect(await au.sweep()).toEqual([['a', ':success']]);
        t += 3600e3;
        expect(await au.sweep()).toEqual([]);
        expect(calls).toEqual(['a', 'a', 'a']);

        const none = AutoUpload({now: () => t, configured: () => false, upload: async () => ':success'});
        none.set([ride({id: 'b'})]);
        expect(await none.sweep()).toEqual([]);
    });
});

describe('Workouts > Activities', () => {
    test('every saved ride, newest first; a click opens its end screen', () => {
        const el = document.createElement('activity-history');
        document.body.appendChild(el);
        expect(el.textContent).toContain('No rides saved');
        xf.dispatch('db:activity', {activity: [
            ride({id: 'old', name: 'Z2 2.5hr', timestamp: NOW - 86400e3}),
            ride({id: 'new', name: 'Capped sub-threshold', rpe: 6, feel: 2, status: {intervals: 'success'}}),
        ]});
        const names = [...el.querySelectorAll('.ah--name')].map((n) => n.textContent);
        expect(names).toEqual(['Capped sub-threshold', 'Z2 2.5hr']);
        expect(el.textContent).toContain('RPE 6 · strong');
        expect(el.textContent).toContain('✓ intervals.icu');
        expect(el.textContent).toContain('not uploaded');

        const opened = [];
        xf.sub('ui:ride-summary:open', (id) => opened.push(id));
        el.querySelector('[data-id="old"] .ah--name').click();
        expect(opened).toEqual(['old']);

        xf.dispatch('activity:uploading', {id: 'old', service: 'intervals'});
        expect(el.querySelector('[data-id="old"]').textContent).toContain('uploading…');
        xf.dispatch('activity:deleted', 'old');
        expect(el.querySelector('[data-id="old"]')).toBe(null);
        el.remove();
    });
});

describe('a ride, deleted and kept', () => {
    beforeAll(async () => {
        global.console.log = () => {};
        await idb.start('store', 4, ['session', 'workouts', 'activity', 'chunks']);
    });
    test('Delete takes it out of this browser and the list', async () => {
        await idb.put('activity', {id: 'x1', summary: {id: 'x1', name: 'X'}});
        const db = {activity: [{id: 'x1'}, {id: 'x2'}]};
        const gone = [];
        xf.sub('activity:deleted', (id) => gone.push(id));
        await models.activity.delete('x1', db);
        expect(await models.activity.get('x1')).toBe(null);
        expect(db.activity.map((a) => a.id)).toEqual(['x2']);
        expect(gone).toContain('x1');
    });
    test('100 rides are kept, not 7', () => {
        expect(models.activity.capacity).toBe(100);
    });
    test('two uploads of one ride at once are one', async () => {
        await idb.put('activity', {id: 'u1', summary: {id: 'u1', name: 'U', status: {intervals: 'none'}}});
        let n = 0;
        const api = models.activity.api;
        models.activity.api = {intervals: {uploadWorkout: async () => { n++; await new Promise((r) => setTimeout(r, 20)); return ':success'; }}};
        const [a, b] = await Promise.all([models.activity.upload('intervals', 'u1'), models.activity.upload('intervals', 'u1')]);
        expect([a, b, n]).toEqual([':success', ':success', 1]);
        models.activity.api = api;
    });
});
