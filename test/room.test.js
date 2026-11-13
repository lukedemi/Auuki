/**
 * @jest-environment jsdom
 */

import { xf } from '../src/functions.js';
import { shape, template, ENTITIES, onRequestGet } from '../functions/api/room.js';
import { Room, roomSummary } from '../src/room.js';
import { co2Level, fansText } from '../src/views/room-status.js';
import { roomLine } from '../src/views/ride-summary.js';

// jsdom has no Response; the Pages Function only needs its body and status
global.Response = global.Response ?? class { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; } };

const now = 1794596000;
const raw = (over = {}) => Object.assign({
    'sensor.trainer_room_temperature': ['62.4', now - 60],
    'sensor.basement_exercise_area_trainer_room_co2_temperature': ['63.7', now - 30],
    'sensor.trainer_room_humidity': ['50', now - 600],
    'sensor.basement_exercise_area_trainer_room_co2_humidity': ['47.4', now - 30],
    'sensor.basement_exercise_area_trainer_room_co2_carbon_dioxide': ['658.0', now - 30],
    'switch.trainer_front_fan': ['on', now - 5000],
    'sensor.trainer_front_fan_power': ['48.2', now - 5000],
    'switch.trainer_rear_fan': ['off', now - 5000],
    'sensor.trainer_rear_fan_power': ['26.3', now - 9000],
}, over);

describe('the room, from Home Assistant', () => {
    test('one template for every entity', () => {
        const t = template(Object.values(ENTITIES).flat());
        expect(t).toContain("states('sensor.trainer_room_temperature') | tojson");
        expect(t.startsWith('{') && t.endsWith('}')).toBe(true);
    });
    test('the room sensor first; fans by switch, watts however old', () => {
        expect(shape(raw(), now)).toEqual({temp_f: 62.4, humidity: 50, co2: 658,
            fans: {front: {on: true, w: 48}, rear: {on: false, w: 0}}, at: now});
    });
    test('a stale or dead sensor falls to the next; none at all is null', () => {
        const r = shape(raw({'sensor.trainer_room_temperature': ['62.4', now - 3600], 'sensor.trainer_room_humidity': ['unavailable', now]}), now);
        expect(r.temp_f).toBe(63.7);
        expect(r.humidity).toBe(47.4);
        const none = shape(raw({'sensor.basement_exercise_area_trainer_room_co2_carbon_dioxide': ['unknown', now], 'switch.trainer_front_fan': ['unavailable', now]}), now);
        expect(none.co2).toBe(null);
        expect(none.fans.front).toBe(null);
    });
    test('the endpoint retries the house\'s front door, and says when HA is not set up', async () => {
        expect((await onRequestGet({env: {}})).status).toBe(503);
        let n = 0;
        global.fetch = jest.fn(async () => { if(++n < 3) throw new Error('reset'); return {ok: true, status: 200, text: async () => JSON.stringify(raw())}; });
        const r = await onRequestGet({env: {HA_URL: 'https://ha.example/', HA_TOKEN: 't'}});
        expect(r.status).toBe(200);
        expect(n).toBe(3);
        expect(global.fetch.mock.calls[0][0]).toBe('https://ha.example/api/template');
        delete global.fetch;
    });
});

describe('the room, logged with the ride', () => {
    test('once a minute while the timer runs; a new ride starts a new log', () => {
        const room = Room();
        const r = {temp_f: 62, humidity: 50, co2: 650, fans: {front: {on: true, w: 48}, rear: {on: false, w: 0}}};
        room._running(true);
        room.onReading(r);                       // no elapsed yet: logged at 0
        for(let t = 1; t <= 150; t++) { room.onElapsed(t); }
        room.onReading({...r, co2: 900});
        expect(room.log().map((x) => x.t)).toEqual([0, 60, 120]);
        room._running(false);
        for(let t = 151; t <= 400; t++) room.onElapsed(t);
        expect(room.log().length).toBe(3);
        room._running(true);
        room.onElapsed(5);                       // the clock went back: a new ride
        expect(room.log().map((x) => x.t)).toEqual([5]);
    });
    test('the end screen line', () => {
        const log = [
            {t: 0, temp: 62.4, hum: 50, co2: 660, front: 1, rear: 0},
            {t: 1800, temp: 64.0, hum: 53, co2: 1180, front: 1, rear: 1},
            {t: 3600, temp: 65.1, hum: 55, co2: 1120, front: 1, rear: 0},
        ];
        const s = roomSummary(log);
        expect(s.front).toBe(60);
        expect(s.rear).toBe(30);
        expect(roomLine(s)).toBe('Room  62.4 → 65.1°F · 50 → 55% · CO₂ 660 → 1,120 ppm (max 1,180) · fans: front 60 min, rear 30 min');
        expect(roomLine(roomSummary([]))).toBe('');
    });
    test('the strip: CO2 colours and the fans in a word', () => {
        expect([co2Level(800), co2Level(1000), co2Level(1500)]).toEqual(['', 'warn', 'high']);
        expect(fansText({front: {on: false, w: 0}, rear: {on: false, w: 0}}).text).toBe('off');
        expect(fansText({front: {on: true, w: 48}, rear: {on: false, w: 0}}).text).toBe('front · 48 W');
        expect(fansText({front: {on: true, w: 48}, rear: {on: true, w: 26}}).text).toBe('both · 74 W');
        expect(fansText({})).toBe(null);
    });
});
