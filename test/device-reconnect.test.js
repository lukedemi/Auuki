/**
 * @jest-environment jsdom
 */

import { xf } from '../src/functions.js';
import { REMEMBER_KEY } from '../src/ble/reactive-connectable.js';
import '../src/views/device-reconnect.js';

describe('Reconnect, one click a device', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({
            'ble:controllable': {id: 'a', name: 'Zwift Hub'},
            'ble:powerMeter': {id: 'b', name: 'ASSIOMA05693L'},
            'ble:heartRateMonitor': {id: 'c', name: '8544-1'},
        }));
    });
    afterEach(() => { jest.useRealTimers(); localStorage.clear(); });

    test('a button for each remembered device not connected; each goes as it connects', () => {
        const el = document.createElement('device-reconnect');
        document.body.appendChild(el);
        xf.dispatch('ble:heartRateMonitor:connected');
        expect(el.classList.contains('on')).toBe(false);      // waits a few seconds for the browser's own reconnect
        jest.advanceTimersByTime(4100);
        expect(el.classList.contains('on')).toBe(true);
        expect([...el.querySelectorAll('[data-id]')].map((b) => b.dataset.id)).toEqual(['ble:controllable', 'ble:powerMeter']);
        expect(el.textContent).toContain('chrome://flags/#enable-web-bluetooth-new-permissions-backend');

        const asked = [];
        xf.sub('ui:ble:powerMeter:reconnect', () => asked.push('pm'));
        el.querySelector('[data-id="ble:powerMeter"]').click();
        expect(asked).toEqual(['pm']);

        xf.dispatch('ble:powerMeter:connected');
        xf.dispatch('ble:controllable:connected');
        expect(el.classList.contains('on')).toBe(false);
        el.remove();
    });

    test('never over a ride, and Not now puts it away', () => {
        const el = document.createElement('device-reconnect');
        document.body.appendChild(el);
        jest.advanceTimersByTime(4100);
        expect(el.classList.contains('on')).toBe(true);
        xf.dispatch('db:watchStatus', {watchStatus: 'started'});
        expect(el.classList.contains('on')).toBe(false);
        xf.dispatch('db:watchStatus', {watchStatus: 'stopped'});
        expect(el.classList.contains('on')).toBe(true);
        el.querySelector('.dr--close').click();
        expect(el.classList.contains('on')).toBe(false);
        el.remove();
    });
});

describe('the picker narrowed to one device', () => {
    test('each filter keeps its services and gains the name', async () => {
        const { default: Connectable } = await Promise.resolve(require('../src/ble/connectable.js'));
        const { webBle } = require('../src/ble/web-ble.js');
        let asked = null;
        global.navigator.bluetooth = {requestDevice: async (opts) => { asked = opts; const e = new Error('closed'); e.name = 'NotFoundError'; throw e; }};
        const c = Connectable({filter: webBle.filters.powerMeter(), onData() {}, onConnecting() {}, onConnected() {}, onDisconnect() {}, onConnectFail() {}});
        const res = await c.connectByName('ASSIOMA05693L');
        expect(asked.filters).toEqual([{services: ['00001818-0000-1000-8000-00805f9b34fb'], name: 'ASSIOMA05693L'}]);
        expect(asked.optionalServices.length).toBeGreaterThan(0);
        expect(res).toEqual({ok: false, reason: 'picker closed'});
        delete global.navigator.bluetooth;
    });
});
