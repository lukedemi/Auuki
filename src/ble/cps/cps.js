//
// Cycling Power Service
//
// Power from the measurement characteristic, as upstream. And, this fork
// (Nov 17, 2026), the pedals' settings through the control point when they
// offer it: read and set the crank length, and zero them (offset
// compensation). The feature characteristic says which of those a meter
// supports. None of it is needed for power: if the control point is
// missing or refuses, the meter is only read.
//

import { expect } from '../../functions.js';
import { uuids, } from '../web-ble.js';
import { Service } from '../service.js';
import { Characteristic } from '../characteristic.js';
import { cyclingPowerMeasurement as cyclingPowerMeasurementParser } from './cycling-power-measurement.js';
import { feature as featureParser } from './cycling-power-feature.js';
import { control as controlParser } from './control-point.js';

const ANSWER_MS = 5000;
// zeroing takes the pedals a few seconds
const ZERO_MS = 15000;

function CPS(args = {}) {
    // config
    // BluetoothRemoteGATTService{
    //     device: BluetoothDevice,
    //     uuid: String,
    //     isPrimary: Bool,
    // }
    const gattService = expect(
        args.service, 'CPS needs BluetoothRemoteGATTService!'
    );

    // {} -> Void
    const onData = args.onData;
    // end config

    // Service
    const spec = {
        measurement: {
            uuid: uuids.cyclingPowerMeasurement,
            notify: {callback: onData, parser: cyclingPowerMeasurementParser},
        },
    };
    const service = Service({service: gattService, spec,});

    let features = {};
    let control = null;
    let pending = null;     // {op, resolve, reject, timer}

    function onControl(view) {
        const res = controlParser.decodeResponse(view);
        if(!res || !pending || pending.op !== res.request) return;
        clearTimeout(pending.timer);
        const p = pending;
        pending = null;
        p.resolve(res);
    }

    async function setupControl() {
        try {
            const raw = await gattService.getCharacteristic(uuids.cyclingPowerFeature);
            const value = await raw.readValue();
            features = featureParser.decode(value) ?? {};
        } catch(e) {
            features = {};
        }
        try {
            const raw = await gattService.getCharacteristic(uuids.cyclingPowerControlPoint);
            control = Characteristic({characteristic: raw});
            const ok = await control.startNotificationsWithRetry(onControl, 3);
            if(!ok) control = null;
        } catch(e) {
            control = null;
        }
    }

    async function setup() {
        const res = await service.setup();
        if(res) await setupControl();
        return res;
    }

    // one request at a time, answered by its own op code
    function request(op, buffer, ms = ANSWER_MS) {
        if(!control) return Promise.reject(new Error('these pedals do not take settings over Bluetooth'));
        if(pending) return Promise.reject(new Error('the pedals are still answering the last request'));
        return new Promise((resolve, reject) => {
            pending = {op, resolve, reject, timer: setTimeout(() => {
                if(pending?.op === op) { pending = null; reject(new Error('the pedals did not answer')); }
            }, ms)};
            control.write(buffer).then((ok) => {
                if(!ok && pending?.op === op) { clearTimeout(pending.timer); pending = null; reject(new Error('the pedals refused the write')); }
            });
        });
    }

    function capabilities() {
        return {
            control: !!control,
            crankLength: !!control && features.crankLengthAdjustmentSupported !== false,
            zero: !!control && features.offsetCompensationSupported !== false,
        };
    }

    async function getCrankLength() {
        const res = await request(controlParser.OP.requestCrankLength, controlParser.encodeRequestCrankLength());
        if(!res.ok) throw new Error(`the pedals answered: ${res.result}`);
        return res.crankLength;
    }

    async function setCrankLength(mm) {
        const res = await request(controlParser.OP.setCrankLength, controlParser.encodeSetCrankLength(mm));
        if(!res.ok) throw new Error(`the pedals answered: ${res.result}`);
        return getCrankLength();
    }

    async function zero() {
        const res = await request(controlParser.OP.startOffsetCompensation, controlParser.encodeStartOffsetCompensation(), ZERO_MS);
        if(!res.ok) throw new Error(`the pedals answered: ${res.result}`);
        return res.offset ?? null;
    }

    return Object.freeze({
        ...service, // CPS will have all the public methods and properties of Service
        setup,
        capabilities,
        getCrankLength,
        setCrankLength,
        zero,
        _onControl: onControl,
    });
}

export default CPS;
