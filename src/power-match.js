//
// Power Match
//
// In ERG mode the trainer holds *its own* power reading at the target. When
// the power source is a separate power meter (pedals, a crank, a hub), that
// meter usually reads a few percent off the trainer, so the workout is ridden
// at the trainer's number and recorded at the meter's.
//
// Power Match learns the ratio between the two (meter / trainer) from both
// live streams and asks the trainer for target / ratio, so the *meter* lands
// on the target. The ratio is measured from the two readings of the same
// effort, independent of what the trainer was commanded, so it does not fight
// the trainer's own ERG loop: it is a slow calibration, not a second
// controller.
//
// Active only when the Power source is the Bluetooth power meter, the Power
// Match setting is on (the default), and the mode is ERG (the trainer ignores
// power targets in any other mode).
//

import { xf, exists, equals, } from './functions.js';

const defaults = {
    tau:          20,     // s, time constant of the moving averages
    warmup:       15,     // s of paired samples before the ratio is trusted
    minPower:     50,     // W, ignore coasting and soft-pedalling
    maxAge:       3000,   // ms, a trainer reading older than this is stale
    maxGap:       5,      // s, longest gap counted as continuous riding
    minRatio:     0.8,    // clamp: a meter 20% off the trainer is a fault,
    maxRatio:     1.2,    // not something to chase
    resendEvery:  3000,   // ms, at most one correction per this interval
    resendDelta:  2,      // W, smallest correction worth sending
};

// The calibration itself, with no I/O, so it can be tested on its own.
function PowerMatchCore(args = {}) {
    const c = Object.assign({}, defaults, args);

    let trainer;          // {power, t}
    let emaTrainer;
    let emaMeter;
    let lastT;
    let paired = 0;       // seconds of paired samples

    function reset() {
        trainer    = undefined;
        emaTrainer = undefined;
        emaMeter   = undefined;
        lastT      = undefined;
        paired     = 0;
    }

    function onTrainer(power, t) {
        trainer = {power, t};
    }

    // the meter drives the clock: each meter sample is paired with the
    // latest trainer sample
    function onMeter(power, t) {
        if(!exists(trainer)) return;
        if((t - trainer.t) > c.maxAge) return;
        if(power < c.minPower || trainer.power < c.minPower) {
            lastT = undefined;
            return;
        }

        if(!exists(emaMeter)) {
            emaMeter   = power;
            emaTrainer = trainer.power;
            paired     = 0;
            lastT      = t;
            return;
        }

        const dt = exists(lastT) ? Math.min((t - lastT) / 1000, c.maxGap) : 1;
        lastT = t;
        if(dt <= 0) return;

        const alpha = 1 - Math.exp(-dt / c.tau);
        emaMeter   += alpha * (power - emaMeter);
        emaTrainer += alpha * (trainer.power - emaTrainer);
        paired     += dt;
    }

    function isReady() {
        return exists(emaMeter) && paired >= c.warmup;
    }

    // meter / trainer, 1 until there is enough data
    function ratio() {
        if(!isReady()) return 1;
        const r = emaMeter / emaTrainer;
        return Math.min(Math.max(r, c.minRatio), c.maxRatio);
    }

    // the target to send the trainer so the meter reads `target`
    function adjust(target) {
        if(!exists(target) || target <= 0) return target;
        return Math.round(target / ratio());
    }

    reset();

    return Object.freeze({
        onTrainer,
        onMeter,
        isReady,
        ratio,
        adjust,
        reset,
        config: c,
    });
}

const meterId   = 'ble:powerMeter';
const trainerId = 'ble:controllable';

// Wires the core to the app: reads db:powerTarget and the two power streams,
// writes trainer:powerTarget, which is what the trainer actually receives.
function PowerMatch(args = {}) {
    const core = PowerMatchCore(args);
    const now  = args.now ?? (() => Date.now());

    let enabled  = false;
    let target   = 0;
    let lastSent;
    let lastSentT = 0;

    function isEnabled(sources = {}) {
        return equals(sources.power, meterId) && (sources.powerMatch ?? true);
    }

    function trainerTarget() {
        return enabled ? core.adjust(target) : target;
    }

    function send() {
        const value = trainerTarget();
        lastSent  = value;
        lastSentT = now();
        xf.dispatch('trainer:powerTarget', value);
        status();
    }

    function status() {
        const active = enabled && core.isReady();
        xf.dispatch('powerMatch:status', {
            enabled,
            active,
            ratio: active ? core.ratio() : 1,
            target,
            trainerTarget: lastSent ?? target,
        });
    }

    function onSources(sources) {
        const next = isEnabled(sources);
        if(equals(next, enabled)) return;
        enabled = next;
        core.reset();
        send();
    }

    function onPowerTarget(value) {
        target = value;
        send();
    }

    function onTrainerPower(power) {
        core.onTrainer(power, now());
    }

    function onMeterPower(power) {
        if(!enabled) return;
        core.onMeter(power, now());

        if(target <= 0 || !core.isReady()) return;

        const value = core.adjust(target);
        if(Math.abs(value - (lastSent ?? target)) >= core.config.resendDelta &&
           (now() - lastSentT) >= core.config.resendEvery) {
            send();
        } else {
            status();
        }
    }

    function onDisconnect() {
        core.reset();
        send();
    }

    let abortController;

    function start() {
        abortController = new AbortController();
        const signal = { signal: abortController.signal };

        xf.sub('db:sources',                  onSources, signal);
        xf.sub('db:powerTarget',              onPowerTarget, signal);
        xf.sub(`${trainerId}:power`,          onTrainerPower, signal);
        xf.sub(`${meterId}:power`,            onMeterPower, signal);
        xf.sub(`${meterId}:disconnected`,     onDisconnect, signal);
        xf.sub(`${trainerId}:disconnected`,   onDisconnect, signal);
    }

    function stop() {
        abortController?.abort();
    }

    return Object.freeze({
        start,
        stop,
        core,
        trainerTarget,
    });
}

const powerMatch = PowerMatch();
powerMatch.start();

export default powerMatch;

export {
    PowerMatchCore,
    PowerMatch,
};
