/**
 * @jest-environment jsdom
 */

import direct from '../../src/models/intervals-direct.js';

function respond(body, {status = 200, type = 'application/json'} = {}) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => type },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    });
}

describe('intervals-direct', () => {
    beforeEach(() => {
        localStorage.clear();
        global.fetch = jest.fn();
    });

    test('not configured without a key', async () => {
        expect(direct.isConfigured()).toBe(false);
        await expect(direct.athlete()).rejects.toThrow(/no intervals.icu API key/);
        expect(fetch).not.toHaveBeenCalled();
    });

    test('save trims and defaults the athlete to 0', () => {
        direct.save({key: '  abc  ', athlete: ' '});
        expect(direct.load()).toEqual({key: 'abc', athlete: '0'});
        expect(direct.isConfigured()).toBe(true);
        direct.clear();
        expect(direct.isConfigured()).toBe(false);
    });

    test('athlete: basic auth with API_KEY, athlete 0', async () => {
        direct.save({key: 'k123'});
        fetch.mockReturnValue(respond({id: 'i1', name: 'luke'}));

        const athlete = await direct.athlete();
        expect(athlete.name).toBe('luke');

        const [url, opts] = fetch.mock.calls[0];
        expect(url).toBe('https://intervals.icu/api/v1/athlete/0');
        expect(opts.headers.Authorization).toBe('Basic ' + btoa('API_KEY:k123'));
    });

    test('events: asks for .zwo and keeps only rides that have one', async () => {
        direct.save({key: 'k', athlete: 'i99'});
        fetch.mockReturnValue(respond([
            {id: 1, type: 'Ride',           workout_file_base64: 'AAA'},
            {id: 2, type: 'VirtualRide',    workout_file_base64: 'BBB'},
            {id: 3, type: 'WeightTraining', workout_file_base64: 'CCC'},
            {id: 4, type: 'Ride'},
            {id: 5,                         workout_file_base64: 'DDD'},
        ]));

        const events = await direct.events('2026-11-02', '2026-11-08');
        expect(events.map(e => e.id)).toEqual([1, 2, 5]);

        const url = new URL(fetch.mock.calls[0][0]);
        expect(url.pathname).toBe('/api/v1/athlete/i99/events');
        expect(url.searchParams.get('oldest')).toBe('2026-11-02');
        expect(url.searchParams.get('newest')).toBe('2026-11-08');
        expect(url.searchParams.get('ext')).toBe('zwo');
        expect(url.searchParams.get('category')).toBe('WORKOUT');
    });

    test('upload: multipart POST with name and external_id', async () => {
        direct.save({key: 'k'});
        fetch.mockReturnValue(respond({id: 'i555'}));

        const blob = new Blob([new Uint8Array([1, 2, 3])]);
        const result = await direct.upload(blob, {name: 'Z2 2hr', externalId: 'auuki-x'});
        expect(result.id).toBe('i555');

        const [url, opts] = fetch.mock.calls[0];
        const u = new URL(url);
        expect(u.pathname).toBe('/api/v1/athlete/0/activities');
        expect(u.searchParams.get('name')).toBe('Z2 2hr');
        expect(u.searchParams.get('external_id')).toBe('auuki-x');
        expect(opts.method).toBe('POST');
        expect(opts.body instanceof FormData).toBe(true);
        expect(opts.body.get('file')).toBeTruthy();
    });

    test('a refused key says so', async () => {
        direct.save({key: 'bad'});
        fetch.mockReturnValue(respond('Unauthorized', {status: 401, type: 'text/plain'}));
        await expect(direct.athlete()).rejects.toThrow(/refused/);
    });
});
