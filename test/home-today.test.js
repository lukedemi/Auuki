/**
 * @jest-environment jsdom
 */
import { week, filtered, dayKey, clock } from '../src/views/home-today.js';

describe('Home', () => {
    test('the week runs Monday to Sunday around today, with what is planned each day', () => {
        const wed = new Date(2026, 10, 18, 10);           // Wednesday, Nov 18, 2026
        const planned = [
            {id: 'a', meta: {name: 'Over-unders', startDateLocal: '2026-11-17T09:00:00'}},
            {id: 'b', meta: {name: 'Sweet spot', startDateLocal: '2026-11-18T09:00:00'}},
            {id: 'c', meta: {name: 'Next week', startDateLocal: '2026-11-24T09:00:00'}},
        ];
        const days = week(planned, wed);
        expect(days.map((d) => d.name)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
        expect(days[0].key).toBe('2026-11-16');
        expect(days[6].key).toBe('2026-11-22');
        expect(days[1].past).toBe(true);
        expect(days[2].today).toBe(true);
        expect(days[2].workouts.map((w) => w.id)).toEqual(['b']);
        expect(days.flatMap((d) => d.workouts).map((w) => w.id)).toEqual(['a', 'b']);   // next week's is not in it
        // a Sunday still belongs to the week that started the Monday before
        expect(week([], new Date(2026, 10, 22))[0].key).toBe('2026-11-16');
    });

    test('the library filters by type, length and a search', () => {
        const lib = [
            {id: 1, meta: {name: 'Dijon', category: 'VO2 Max'}, s: 57 * 60},
            {id: 2, meta: {name: 'Chili Pepper', category: 'VO2 Max'}, s: 30 * 60},
            {id: 3, meta: {name: 'Long base', category: 'Base', description: 'steady endurance'}, s: 120 * 60},
        ];
        const secs = (w) => w.s;
        expect(filtered(lib, {}, secs).length).toBe(3);
        expect(filtered(lib, {type: 'VO2 Max'}, secs).map((w) => w.id)).toEqual([1, 2]);
        expect(filtered(lib, {length: 'short'}, secs).map((w) => w.id)).toEqual([2]);
        expect(filtered(lib, {length: 'mid'}, secs).map((w) => w.id)).toEqual([1]);
        expect(filtered(lib, {length: 'long'}, secs).map((w) => w.id)).toEqual([3]);
        expect(filtered(lib, {q: 'ENDURANCE'}, secs).map((w) => w.id)).toEqual([3]);
        expect(filtered(lib, {type: 'VO2 Max', q: 'chili'}, secs).map((w) => w.id)).toEqual([2]);
    });

    test('days and durations read the way the page shows them', () => {
        expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
        expect(clock(57 * 60)).toBe('57 min');
        expect(clock(90 * 60)).toBe('1 h 30');
        expect(clock(120 * 60)).toBe('2 h');
    });
});
