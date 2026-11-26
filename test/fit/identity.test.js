import { fit } from '../../src/fit/fit.js';

// Nov 26, 2026: Strava showed infERGno's rides as "Garmin Edge 1030 Plus",
// because upstream wrote Garmin's manufacturer and the Edge 1030's product id
// into every file. The file now says what made it.
describe('the ride file says infERGno made it', () => {
    const t0 = Date.UTC(2026, 10, 26, 15, 36, 0);
    const records = Array.from({length: 30}, (_, i) => ({timestamp: t0 + i * 1000, power: 200, cadence: 88, heart_rate: 130, speed: 9.5, distance: i * 9.5}));
    const laps = [{timestamp: t0 + 29000, start_time: t0, total_elapsed_time: 30, total_timer_time: 30, avg_power: 200, max_power: 200, avg_cadence: 88, avg_heart_rate: 130, max_heart_rate: 130, total_distance: 275}];
    const events = [{timestamp: t0, type: 0}, {timestamp: t0 + 29000, type: 4}];
    const view = fit.localActivity.encode({records, laps, events, ftp: 282});
    const bytes = new Uint8Array(view.buffer ?? view);

    test('the development manufacturer and the product name, not a Garmin Edge', () => {
        const text = String.fromCharCode(...bytes);
        expect(text).toContain('infERGno');
        const msgs = fit.FITjs.decode(new DataView(bytes.buffer)).filter((m) => m.type === 'data');
        const id = msgs.find((m) => m.name === 'file_id');
        expect(id.fields.manufacturer).toBe(255);
        expect(id.fields.product).toBe(0);
        expect(String(id.fields.product_name).replace(/\0+$/, '')).toBe('infERGno');
        expect(msgs.filter((m) => m.name === 'record')).toHaveLength(30);
    });
});
