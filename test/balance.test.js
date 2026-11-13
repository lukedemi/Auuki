/**
 * @jest-environment jsdom
 */

const fs = require('node:fs');
const { CyclingPowerMeasurement } = require('../src/ble/cps/cycling-power-measurement.js');
const { balanceToFit } = require('../src/models/models.js');
const { fit } = require('../src/fit/fit.js');

function cps(bytes) {
    return new DataView(new Uint8Array(bytes).buffer);
}

describe('L/R balance', () => {
    test('read from a Cycling Power Measurement: flags 0x23 = balance, left reference, crank data', () => {
        // flags 0x0023: balance present, reference left, crank revolutions
        // power 250 W, balance 98 (x0.5 = 49%), crank revs 10, crank time 1024
        const m = CyclingPowerMeasurement();
        const d = m.decode(cps([0x23, 0x00, 0xFA, 0x00, 98, 10, 0, 0x00, 0x04]));
        expect(d.power).toBe(250);
        expect(d.pedalPowerBalance).toBe(49);
    });

    test('to FIT: the share of the right with bit 7 set; 0xFF without a two-sided meter', () => {
        expect(balanceToFit(49)).toBe(0x80 | 51);
        expect(balanceToFit(50.5)).toBe(0x80 | 50);   // 49.5 rounds to 50
        expect(balanceToFit(null)).toBe(0xFF);
        expect(balanceToFit(undefined)).toBe(0xFF);
    });

    test('the FIT file carries left_right_balance on every record', () => {
        const t0 = Date.UTC(2026, 10, 13, 17, 0, 0);
        const records = Array.from({length: 60}, (_, i) => ({
            timestamp: t0 + i * 1000, power: 250, cadence: 90, speed: 9, heart_rate: 140, distance: i * 9,
            grade: 0, altitude: 0, position_lat: 0, position_long: 0, device_index: 0,
            left_right_balance: i < 30 ? balanceToFit(49) : balanceToFit(null),
        }));
        const laps = [{timestamp: t0 + 59000, start_time: t0, totalElapsedTime: 59, totalTimerTime: 59}];
        const events = [{timestamp: t0, type: 'start'}, {timestamp: t0 + 59000, type: 'stop'}];
        const bytes = fit.localActivity.encode({records, laps, events, ftp: 295});
        expect(bytes.byteLength).toBeGreaterThan(1000);
        // kept for the check with Garmin's own decoder (outside jest)
        if(process.env.FIT_OUT) fs.writeFileSync(process.env.FIT_OUT, Buffer.from(bytes.buffer ?? bytes));
    });
});
