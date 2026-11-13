import { equals, exists, isArray, xf, print, } from '../functions.js';
import { models } from '../models/models.js';
import Connectable from './connectable.js';
import { webBle } from './web-ble.js';
import { Device, Status, ControlMode, } from './enums.js';

const REMEMBER_KEY = 'ble:remembered';

function remembered() {
    try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? '{}') ?? {}; } catch(e) { return {}; }
}

// Settings > Reconnect Devices, on by default (stored with the other sources)
function reconnectOnLoad() {
    try { return (JSON.parse(localStorage.getItem('sources') ?? '{}') ?? {}).reconnectDevices ?? true; } catch(e) { return true; }
}

function ReactiveConnectable(args = {}) {
    // config
    const deviceType = args.deviceType ?? Device.generic;
    const filter = args.filter ?? webBle.filters.generic();
    const identifier = `ble:${deviceType}`;

    const connectable = Connectable({
        filter,
        onData,
        onConnecting,
        onConnected,
        onDisconnect,
        onConnectFail,
    });
    // end config

    // state
    let mode = ControlMode.erg;

    let abortController;
    let signal;
    // end state

    function getIdentifier() {
        return identifier;
    }

    function onConnecting() {
        xf.dispatch(`${getIdentifier()}:connecting`);
    }

    function onConnected() {
        xf.dispatch(`${getIdentifier()}:connected`);
        xf.dispatch(`${getIdentifier()}:name`, connectable.getName());
        remember();
    }

    // Remembered devices (this fork, Nov 13, 2026): the last device of this
    // type that connected, by its Web Bluetooth id, reconnected on load
    // without the chooser when Settings > Reconnect Devices is on.
    function remember() {
        const id = connectable.getId();
        if(!id) return;
        const all = remembered();
        all[identifier] = {id, name: connectable.getName(), at: Date.now()};
        try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(all)); } catch(e) {}
    }

    async function reconnectRemembered() {
        const device = remembered()[identifier];
        if(!device || connectable.isConnected()) return;
        for(let tries = 1; tries <= 3; tries++) {
            if(connectable.isConnected() || cancelled) return;
            xf.dispatch('ble:reconnect', {identifier, name: device.name, try: tries, state: 'watching'});
            const res = await connectable.reconnect(device.id);
            xf.dispatch('ble:reconnect', {identifier, name: device.name, try: tries, state: res.ok ? 'connected' : 'failed', reason: res.reason});
            if(res.ok || cancelled) return;
            // nothing to wait for if the browser no longer knows the device
            if(!/did not answer|advertisement/.test(res.reason)) return;
        }
    }
    let cancelled = false;

    function onDisconnect() {
        xf.dispatch(`${getIdentifier()}:disconnected`);
        xf.dispatch(`${getIdentifier()}:name`, '--');

        if(models.sources.isSource('power', getIdentifier())) {
            xf.dispatch(`power`, 0);
            xf.dispatch('balance', null);
        }
        if(models.sources.isSource('cadence', getIdentifier())) {
            xf.dispatch(`cadence`, 0);
        }
        if(models.sources.isSource('speed', getIdentifier())) {
            xf.dispatch(`speed`, 0);
        }
        if(models.sources.isSource('heartRate', getIdentifier())) {
            xf.dispatch(`heartRate`, 0);
        }
        if(models.sources.isSource('smo2', getIdentifier())) {
            xf.dispatch(`smo2`, 0);
        }
        if(models.sources.isSource('thb', getIdentifier())) {
            xf.dispatch(`thb`, 0);
        }
        if(models.sources.isSource('coreBodyTemperature', getIdentifier())) {
            xf.dispatch(`coreBodyTemperature`, 0);
            xf.dispatch(`skinTemperature`, 0);
        }
    }

    function onConnectFail() {
        xf.dispatch(`${getIdentifier()}:disconnected`);
    }

    function onData(data) {
        // every device's own power reading, whichever is the source:
        // power-match.js pairs the trainer's with the power meter's
        if('power' in data) {
            xf.dispatch(`${identifier}:power`, data.power);
        }

        if('power' in data && models.sources.isSource('power', identifier)) {
            xf.dispatch(`power`, data.power);
        }

        // L/R balance (this fork, Nov 13, 2026): a power meter with both
        // sides (Assioma Duo: the left pedal speaks for the pair over
        // Bluetooth) sends the left's share in each Cycling Power
        // Measurement; bit 1 of the flags says it is the left's, and with
        // no reference it is read as the left's too, as head units do
        if('pedalPowerBalance' in data && models.sources.isSource('power', identifier)) {
            xf.dispatch('balance', data.pedalPowerBalance);
        }

        if('cadence' in data && models.sources.isSource('cadence', identifier)) {
            xf.dispatch(`cadence`, data.cadence);
        }

        if('speed' in data && models.sources.isSource('speed', identifier)) {
            xf.dispatch(`speed`, models.speed.kmhToMps(data.speed));
        }

        if('heartRate' in data && models.sources.isSource('heartRate', identifier)) {
            xf.dispatch(`heartRate`, data.heartRate);

            if('rrInterval' in data) {
                xf.dispatch(`rrInterval`, data.rrInterval);
            }
        }

        if('batteryLevel' in data) {
            xf.dispatch(`${getIdentifier()}:batteryLevel`, data.batteryLevel);
            console.log(`:ble :device ${connectable.getName()} ${getIdentifier()} :battery-level ${data.batteryLevel}`);
        }

        if('currentSaturatedHemoglobin' in data) {
            xf.dispatch(`smo2`, data.currentSaturatedHemoglobin);
        }

        if('totalHemoglobinSaturation' in data) {
            xf.dispatch(`thb`, data.totalHemoglobinSaturation);
        }

        if('coreBodyTemperature' in data) {
            xf.dispatch(`coreBodyTemperature`, data.coreBodyTemperature);
        }

        if('skinTemperature' in data) {
            xf.dispatch(`skinTemperature`, data.skinTemperature);
        }

        if(isArray(data) && data.length > 0) {
            xf.dispatch(`${getIdentifier()}:buttonState`, data);
        }
    }

    async function onSwitch() {
        if(connectable.isConnected()) {
            connectable.disconnect();
        } else {
            // a tap while a remembered device is being waited for: stop
            // waiting and open the chooser
            if(connectable.cancelWatch()) cancelled = true;
            connectable.connect({requesting: true});
        }
    }

    function onMode(x) {
        mode = x;
    }

    function onUserWeight(x) {
        if(!connectable.isConnected()) return;
    }

    function onPowerTarget(powerTarget) {
        if(!connectable.isConnected() ||
           !equals(mode, ControlMode.erg)) return;
        connectable.services.trainer.setPowerTarget({power: powerTarget});
    }

    function onResistanceTarget(resistanceTarget) {
        if(!connectable.isConnected() ||
           !equals(mode, ControlMode.resistance)) return;
        connectable.services.trainer.setResistanceTarget({
            resistance: resistanceTarget,
        });
    }

    function onSlopeTarget(slopeTarget) {
        if(!connectable.isConnected() ||
           !equals(mode, ControlMode.sim)) return;
        connectable.services.trainer.setSimulation({grade: slopeTarget});
    }

    function onTrainerReset() {
        if(!connectable.isConnected() ||
           !exists(connectable.services?.trainer?.reset)) return;
        connectable.services.trainer.reset();
    }

    function start() {
        abortController = new AbortController();
        signal = { signal: abortController.signal };

        if(reconnectOnLoad() && remembered()[identifier]) {
            setTimeout(reconnectRemembered, 500);
        }

        xf.sub(`ui:${getIdentifier()}:switch`, onSwitch, signal);

        if(equals(deviceType, Device.controllable)) {
            xf.sub('db:mode',             onMode, signal);
            xf.sub('db:weight',           onUserWeight, signal);
            // db:powerTarget passed through power-match.js
            xf.sub('trainer:powerTarget', onPowerTarget, signal);
            xf.sub('db:resistanceTarget', onResistanceTarget, signal);
            xf.sub('db:slopeTarget',      onSlopeTarget, signal);
            xf.sub('ui:trainer:reset',    onTrainerReset, signal);
        }
    }

    function stop() {
        abortController.abort();
    }

    start();

    return Object.freeze({
        getIdentifier,
        start,
        stop,
        ...connectable
    });
}

export default ReactiveConnectable;
export { remembered, REMEMBER_KEY };

