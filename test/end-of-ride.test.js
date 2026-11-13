/**
 * @jest-environment jsdom
 */

// jsdom has no structuredClone, which fake-indexeddb needs
const v8 = require('node:v8');
global.structuredClone = global.structuredClone ?? ((v) => v8.deserialize(v8.serialize(v)));
require('fake-indexeddb/auto');
import { xf } from '../src/functions.js';
import { idb } from '../src/storage/idb.js';
import { models } from '../src/models/models.js';
import direct from '../src/models/intervals-direct.js';
import '../src/views/pause-overlay.js';
import '../src/views/ride-summary.js';

const start = Date.UTC(2026, 10, 13, 16, 0, 0);
function rideDb(n, name = '📊 Capped sub-threshold — 5x8min') {
    const records = Array.from({length: n}, (_, i) => ({timestamp: start + 1000 * i, power: 200 + (i % 7), heart_rate: 130, cadence: 88, speed: 0, distance: 0}));
    return {elapsed: n, records, laps: [{start_time: start, timestamp: start + 1000 * (n - 1)}], events: [], lap: [],
            activity: [], ftp: 295, workout: {meta: {name}}, watchStatus: 'stopped', sources: {}};
}

const waitFor = async (fn, ms = 2000) => {
    const t0 = Date.now();
    while(Date.now() - t0 < ms) { if(await fn()) return true; await new Promise((r) => setTimeout(r, 10)); }
    return false;
};

beforeAll(async () => {
    global.console.log = () => {};
    window.URL.createObjectURL = window.URL.createObjectURL ?? (() => 'blob:x');
    window.URL.revokeObjectURL = window.URL.revokeObjectURL ?? (() => {});
    await idb.start('store', 4, ['session', 'workouts', 'activity', 'chunks']);
});

describe('stopping saves the ride', () => {
    test('saved, read back, listed, announced', async () => {
        const added = [];
        xf.sub('activity:add', (s) => added.push(s));
        const db = rideDb(120);
        const summary = await models.activity.createFromCurrent(db);
        const saved = await models.activity.get(summary.id);
        expect(saved.summary.name).toBe('📊 Capped sub-threshold — 5x8min');
        expect(saved.blob).toBeDefined();
        expect(db.activity[0].id).toBe(summary.id);
        expect(added.map((s) => s.id)).toContain(summary.id);
    });

    test('a write that does not read back downloads the .fit and throws', async () => {
        const clicks = [];
        const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function() { clicks.push(this.download); });
        // a name IndexedDB cannot clone: the put fails, as a full or broken store would
        const db = rideDb(60, {toString() { return 'x'; }, f: () => 1});
        await expect(models.activity.createFromCurrent(db)).rejects.toThrow(/did not save/);
        expect(clicks.some((n) => /\.fit$/.test(n))).toBe(true);
        expect(db.activity.length).toBe(0);
        click.mockRestore();
    });

    test('the end screen edits are written to the saved ride', async () => {
        const summary = await models.activity.createFromCurrent(rideDb(60));
        await models.activity.update(summary.id, {name: 'Renamed', rpe: 7, feel: 2, notes: 'legs good'});
        const saved = await models.activity.get(summary.id);
        expect(saved.summary).toMatchObject({name: 'Renamed', rpe: 7, feel: 2, notes: 'legs good'});
    });
});

describe('intervals.icu gets the end screen', () => {
    test('the uploaded id, whatever shape', () => {
        expect(direct.uploadedId({icu_athlete_id: 'i1', id: 'i99'})).toBe('i99');
        expect(direct.uploadedId('{"id":"i98"}')).toBe('i98');
        expect(direct.uploadedId({activities: [{id: 'i97'}]})).toBe('i97');
        expect(direct.uploadedId(null)).toBe(null);
    });
    test('only what was set is sent; feel and RPE in range', () => {
        expect(direct.activityFields({name: 'A', rpe: 7, feel: 2, notes: ' ok '})).toEqual({name: 'A', icu_rpe: 7, feel: 2, description: 'ok'});
        expect(direct.activityFields({name: 'A', rpe: null, feel: 9, notes: '  '})).toEqual({name: 'A'});
    });
    test('PUT /activity/{id} with the key', async () => {
        localStorage.setItem('intervals-direct', JSON.stringify({athlete: '0', key: 'k'}));
        const calls = [];
        global.fetch = jest.fn(async (url, opts) => { calls.push([url, opts]); return {ok: true, json: async () => ({})}; });
        await direct.updateActivity('i99', {icu_rpe: 6});
        expect(calls[0][0]).toBe('https://intervals.icu/api/v1/activity/i99');
        expect(calls[0][1].method).toBe('PUT');
        expect(JSON.parse(calls[0][1].body)).toEqual({icu_rpe: 6});
        expect(calls[0][1].headers.Authorization).toMatch(/^Basic /);
        delete global.fetch;
        localStorage.removeItem('intervals-direct');
    });
});

describe('the pause screen ends the ride', () => {
    test('End asks once, in place; the second tap ends it', () => {
        jest.useFakeTimers();
        const el = document.createElement('pause-overlay');
        document.body.appendChild(el);
        const ends = [];
        xf.sub('ui:watchEnd', () => ends.push(1));
        xf.dispatch('db:watchStatus', 'paused');
        const $end = el.querySelector('.po--end');
        $end.click();
        expect(ends.length).toBe(0);
        expect($end.textContent).toMatch(/again/);
        jest.advanceTimersByTime(4100);
        expect($end.textContent).toMatch(/End workout/);
        $end.click(); $end.click();
        expect(ends.length).toBe(1);
        el.remove();
        jest.useRealTimers();
    });
});

describe('the end screen', () => {
    test('opens on a saved ride; RPE, feel and the name are written as they change', async () => {
        const el = document.createElement('ride-summary');
        document.body.appendChild(el);
        const summary = await models.activity.createFromCurrent(rideDb(90));
        expect(await waitFor(() => el.classList.contains('open') && el.querySelector('.rs--name')?.value)).toBe(true);
        expect(el.querySelector('.rs--name').value).toBe('📊 Capped sub-threshold — 5x8min');

        el.querySelector('[data-rpe="6"]').click();
        el.querySelector('[data-feel="2"]').click();
        expect(await waitFor(async () => (await models.activity.get(summary.id)).summary.feel === 2)).toBe(true);
        expect((await models.activity.get(summary.id)).summary.rpe).toBe(6);

        const $name = el.querySelector('.rs--name');
        $name.value = 'Sub-threshold, done';
        $name.dispatchEvent(new Event('input'));
        el.querySelector('.rs--done').click();     // closing writes what is pending
        expect(await waitFor(async () => (await models.activity.get(summary.id)).summary.name === 'Sub-threshold, done')).toBe(true);
        expect(el.classList.contains('open')).toBe(false);

        // the same ride, from its image button
        xf.dispatch('ui:ride-summary:open', summary.id);
        expect(await waitFor(() => el.classList.contains('open') && el.querySelector('.rs--name')?.value === 'Sub-threshold, done')).toBe(true);
        expect(el.querySelector('[data-rpe="6"]').classList.contains('on')).toBe(true);
        el.remove();
    });
});
