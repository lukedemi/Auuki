/**
 * @jest-environment jsdom
 */

// jsdom has no structuredClone, which fake-indexeddb needs
const v8 = require('node:v8');
global.structuredClone = global.structuredClone ?? ((v) => v8.deserialize(v8.serialize(v)));
require('fake-indexeddb/auto');
import { idb } from '../src/storage/idb.js';
import { models } from '../src/models/models.js';

const rec = (i) => ({ timestamp: 1000 * i, power: 200 + (i % 7), heart_rate: 120 + (i % 5), cadence: 88 });

function rideDb(n) {
    return { elapsed: n, records: Array.from({length: n}, (_, i) => rec(i)), laps: [{lap: 1}], events: [], lap: [],
             watchStatus: 'started', workoutStatus: 'started', sources: {} };
}

const chunkSizes = async () => (await idb.getAll('chunks')).sort((a, b) => a.id - b.id).map((c) => c.records.length);

describe('the ride in progress, saved in chunks', () => {
    beforeAll(async () => {
        global.console.log = () => {};
        await idb.start('store', 4, ['session', 'workouts', 'activity', 'chunks']);
    });

    test('each full minute is written once, the tail every time, and a reload gets every second back', async () => {
        const db = rideDb(150);
        await models.session.backup(db);
        expect(await chunkSizes()).toEqual([60, 60, 30]);

        for(let i = 150; i < 200; i++) db.records.push(rec(i));
        db.elapsed = 200;
        await models.session.backup(db);
        expect(await chunkSizes()).toEqual([60, 60, 60, 20]);

        const saved = (await idb.getAll('session'))[0];
        expect(saved.records).toBeUndefined();
        expect(saved.recordCount).toBe(200);

        const fresh = { sources: {} };
        await models.session.restore(fresh);
        expect(fresh.elapsed).toBe(200);
        expect(fresh.records.length).toBe(200);
        expect(fresh.records[199]).toEqual(rec(199));
        expect(fresh.laps).toEqual([{lap: 1}]);
    });

    test('a new, shorter ride replaces the old chunks', async () => {
        await models.session.backup(rideDb(70));
        expect(await chunkSizes()).toEqual([60, 10]);
        const fresh = { sources: {} };
        await models.session.restore(fresh);
        expect(fresh.records.length).toBe(70);
    });

    test('saving the activity clears it, so nothing comes back', async () => {
        await models.session.clearSaved();
        expect(await idb.getAll('chunks')).toEqual([]);
        const fresh = { sources: {} };
        await models.session.restore(fresh);
        expect(fresh.records).toBeUndefined();
    });
});
