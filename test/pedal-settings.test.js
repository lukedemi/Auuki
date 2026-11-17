/**
 * @jest-environment jsdom
 */

import { xf } from '../src/functions.js';
import { control } from '../src/ble/cps/control-point.js';
import CPS from '../src/ble/cps/cps.js';
import { CRANKS } from '../src/views/pedal-settings.js';

const view = (bytes) => new DataView(new Uint8Array(bytes).buffer);

describe('the pedals\' control point', () => {
    test('crank length goes in half millimetres', () => {
        expect(Array.from(new Uint8Array(control.encodeRequestCrankLength()))).toEqual([0x05]);
        expect(Array.from(new Uint8Array(control.encodeSetCrankLength(145)))).toEqual([0x04, 290 & 0xff, 290 >> 8]);
        expect(Array.from(new Uint8Array(control.encodeSetCrankLength(172.5)))).toEqual([0x04, 345 & 0xff, 345 >> 8]);
        expect(() => control.encodeSetCrankLength(14.5)).toThrow(/not plausible/);
        expect(Array.from(new Uint8Array(control.encodeStartOffsetCompensation()))).toEqual([0x0C]);
    });
    test('answers', () => {
        expect(control.decodeResponse(view([0x20, 0x05, 0x01, 290 & 0xff, 290 >> 8]))).toEqual({request: 5, ok: true, result: 'success', crankLength: 145});
        expect(control.decodeResponse(view([0x20, 0x04, 0x02]))).toEqual({request: 4, ok: false, result: 'not supported'});
        expect(control.decodeResponse(view([0x20, 0x0C, 0x01, 0xF6, 0xFF])).offset).toBe(-10);
        expect(control.decodeResponse(view([0x01, 0x02]))).toBe(null);
    });
    test('the menu runs 110 to 200 mm by 2.5', () => {
        expect(CRANKS[0]).toBe(110);
        expect(CRANKS).toContain(145);
        expect(CRANKS).toContain(172.5);
        expect(CRANKS[CRANKS.length - 1]).toBe(200);
    });
});

// a fake pair of pedals behind the Web Bluetooth calls
function fakePedals({crank = 172.5, features = 0x1000 | 0x200} = {}) {
    let listener = null;
    const state = {crank, writes: []};
    const indicate = (bytes) => listener && listener({target: {value: view(bytes)}});
    const chars = {
        '00002a63-0000-1000-8000-00805f9b34fb': {uuid: '00002a63-0000-1000-8000-00805f9b34fb', startNotifications: async () => {}, addEventListener: () => {}},
        '00002a65-0000-1000-8000-00805f9b34fb': {uuid: '00002a65-0000-1000-8000-00805f9b34fb', readValue: async () => { const v = new DataView(new ArrayBuffer(4)); v.setUint32(0, features, true); return v; }},
        '00002a66-0000-1000-8000-00805f9b34fb': {
            uuid: '00002a66-0000-1000-8000-00805f9b34fb',
            startNotifications: async () => {},
            addEventListener: (_, fn) => { listener = fn; },
            writeValueWithResponse: async (buf) => {
                const b = Array.from(new Uint8Array(buf));
                state.writes.push(b);
                setTimeout(() => {
                    if(b[0] === 0x05) indicate([0x20, 0x05, 0x01, (state.crank * 2) & 0xff, (state.crank * 2) >> 8]);
                    if(b[0] === 0x04) { state.crank = (b[1] | (b[2] << 8)) / 2; indicate([0x20, 0x04, 0x01]); }
                    if(b[0] === 0x0C) indicate([0x20, 0x0C, 0x01, 3, 0]);
                }, 5);
            },
        },
    };
    const service = {
        uuid: '00001818-0000-1000-8000-00805f9b34fb',
        getCharacteristics: async () => Object.values(chars),
        getCharacteristic: async (uuid) => { if(!chars[uuid]) throw new Error('none'); return chars[uuid]; },
    };
    return {service, state};
}

describe('the pedals, read and set', () => {
    beforeAll(() => { global.console.log = () => {}; });
    test('reads the crank length, sets 145, zeroes', async () => {
        const {service, state} = fakePedals();
        const cps = CPS({service, onData: () => {}});
        expect(await cps.setup()).toBe(true);
        expect(cps.capabilities()).toEqual({control: true, crankLength: true, zero: true});
        expect(await cps.getCrankLength()).toBe(172.5);
        expect(await cps.setCrankLength(145)).toBe(145);
        expect(state.crank).toBe(145);
        expect(await cps.zero()).toBe(3);
    });
    test('pedals without the control point are only read', async () => {
        const {service} = fakePedals();
        const get = service.getCharacteristic;
        service.getCharacteristic = async (uuid) => { if(uuid.startsWith('00002a66')) throw new Error('none'); return get(uuid); };
        const cps = CPS({service, onData: () => {}});
        expect(await cps.setup()).toBe(true);
        expect(cps.capabilities()).toEqual({control: false, crankLength: false, zero: false});
        await expect(cps.getCrankLength()).rejects.toThrow(/do not take settings/);
    });
    test('the settings card shows what the pedals hold', () => {
        require('../src/views/pedal-settings.js');
        const el = document.createElement('pedal-settings');
        document.body.appendChild(el);
        expect(el.textContent).toContain('connect the pedals');
        xf.dispatch('pedals:caps', {control: true, crankLength: true, zero: true});
        xf.dispatch('pedals:crank', {mm: 172.5});
        expect(el.querySelector('.ps--value').textContent).toBe('172.5 mm');
        const sets = [];
        xf.sub('ui:pedals:crank:set', (mm) => sets.push(mm));
        el.querySelector('select').value = '145';
        el.querySelector('[data-act="set"]').click();
        expect(sets).toEqual([145]);
        xf.dispatch('pedals:crank', {mm: 145, set: true});
        expect(el.textContent).toContain('Set to 145 mm on the pedals');
        xf.dispatch('pedals:caps', {control: false, crankLength: false, zero: false});
        expect(el.textContent).toContain('Favero app');
        el.remove();
    });
});
