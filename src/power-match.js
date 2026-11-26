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

    // Settling (rider, Nov 13, 2026): "the longer we're in a steady interval,
    // the more we should back off power match so that it doesn't respond as
    // quickly ... it's okay to go a little bit off if we know that I'll
    // eventually get back to it." From settleAfter to settleFull seconds into
    // one target, the three knobs above ease out to their calm values:
    settleAfter:  60,     // s at one target before anything eases
    settleFull:   600,    // s at one target when it is fully calm
    calmTau:      120,    // s, the averages' time constant when calm
    calmEvery:    30000,  // ms between corrections when calm
    calmDeltaPct: 2,      // % of the target a correction must be worth when calm
    slowLane:     3,      // a smaller one (still >= resendDelta) waits this many
                          // times as long, so a small gap is closed eventually

    // Starting cold (rider, Nov 26, 2026: "when I start a workout with the
    // sloped power, like the warm-up ... it really bounces around a lot at the
    // start"): pedalling off from a stop, the flywheel takes power the trainer
    // has not counted yet, so the two meters disagree for reasons that have
    // nothing to do with calibration. That much is not learned from; and the
    // ratio from the last ride with the same meter and trainer stands in until
    // this ride has its own.
    spinUp:       10,     // s after pedalling off that teach nothing
};

const lerp = (a, b, k) => a + (b - a) * k;

// How calm the correction is after `steadyS` seconds at one target: 0 at the
// start of an interval (react fast, so a new interval lands), 1 when settled.
function settle(steadyS, target, args = {}) {
    const c = Object.assign({}, defaults, args);
    const k = Math.min(1, Math.max(0, (steadyS - c.settleAfter) / (c.settleFull - c.settleAfter)));
    return {
        k,
        tau:   lerp(c.tau, c.calmTau, k),
        every: lerp(c.resendEvery, c.calmEvery, k),
        delta: Math.max(c.resendDelta, lerp(c.resendDelta, (c.calmDeltaPct / 100) * (target || 0), k)),
        slow:  lerp(c.resendEvery, c.calmEvery * c.slowLane, k),
    };
}

// Whether a correction of `gap` W goes out `sinceMs` after the last one.
function shouldCorrect(gap, sinceMs, s, args = {}) {
    const c = Object.assign({}, defaults, args);
    const g = Math.abs(gap);
    if(g >= s.delta && sinceMs >= s.every) return true;
    return g >= c.resendDelta && sinceMs >= s.slow;
}

// The calibration itself, with no I/O, so it can be tested on its own.
function PowerMatchCore(args = {}) {
    const c = Object.assign({}, defaults, args);

    let trainer;          // {power, t}
    let emaTrainer;
    let emaMeter;
    let lastT;
    let paired = 0;       // seconds of paired samples
    let seedRatio;        // the last ride's ratio, until this one has its own
    let stopped = true;   // not pedalling (or not yet): the next start is a spin-up
    let learnFrom = 0;    // ms: no learning before this (the spin-up)

    function reset() {
        trainer    = undefined;
        emaTrainer = undefined;
        emaMeter   = undefined;
        lastT      = undefined;
        paired     = 0;
        stopped    = true;
    }

    // every meter sample, held or not: when the rider pedals off from a stop,
    // the next spinUp seconds teach nothing (timed from the pedalling, so it
    // runs alongside a new interval's hold rather than after it)
    function observe(power, t) {
        if(!(power >= c.minPower)) { stopped = true; return; }
        if(stopped) { stopped = false; learnFrom = t + c.spinUp * 1000; }
    }

    // the ratio to start from (a remembered one), clamped like any other
    function seed(r) {
        seedRatio = Number.isFinite(r) && r > 0 ? Math.min(Math.max(r, c.minRatio), c.maxRatio) : undefined;
    }

    function onTrainer(power, t) {
        trainer = {power, t};
    }

    // the meter drives the clock: each meter sample is paired with the
    // latest trainer sample
    function onMeter(power, t, tau = c.tau) {
        if(!exists(trainer)) return;
        if((t - trainer.t) > c.maxAge) return;
        observe(power, t);
        if(power < c.minPower || trainer.power < c.minPower) {
            lastT = undefined;
            return;
        }
        // the spin-up teaches nothing
        if(t < learnFrom) {
            lastT = undefined;
            return;
        }

        if(!exists(emaMeter)) {
            // with a remembered ratio, start from it, ready at once; the
            // averages then follow this ride's own readings
            emaTrainer = trainer.power;
            emaMeter   = exists(seedRatio) ? trainer.power * seedRatio : power;
            paired     = exists(seedRatio) ? c.warmup : 0;
            lastT      = t;
            return;
        }

        const dt = exists(lastT) ? Math.min((t - lastT) / 1000, c.maxGap) : 1;
        lastT = t;
        if(dt <= 0) return;

        const alpha = 1 - Math.exp(-dt / tau);
        emaMeter   += alpha * (power - emaMeter);
        emaTrainer += alpha * (trainer.power - emaTrainer);
        paired     += dt;
    }

    function isReady() {
        return exists(emaMeter) && paired >= c.warmup;
    }

    // meter / trainer: the remembered one, or 1, until there is enough data
    function ratio() {
        if(!isReady()) return exists(seedRatio) ? seedRatio : 1;
        const r = emaMeter / emaTrainer;
        return Math.min(Math.max(r, c.minRatio), c.maxRatio);
    }

    // the target to send the trainer so the meter reads `target`
    function adjust(target) {
        if(!exists(target) || target <= 0) return target;
        return Math.round(target / ratio());
    }

    // the next meter sample starts a new pair (after samples were skipped)
    function breakPair() {
        lastT = undefined;
    }

    // for the debug panel and log
    function state() {
        return {
            trainer: trainer?.power,
            emaTrainer,
            emaMeter,
            paired,
            ready: isReady(),
            ratio: ratio(),
            seed: seedRatio,
        };
    }

    reset();

    return Object.freeze({
        onTrainer,
        onMeter,
        isReady,
        ratio,
        adjust,
        reset,
        seed,
        observe,
        breakPair,
        state,
        config: c,
    });
}

const meterId   = 'ble:powerMeter';
const trainerId = 'ble:controllable';

// The ratio each meter and trainer pair settled on, by their Bluetooth names,
// kept in this browser so the next ride with the same pair starts from it.
const MEMORY_KEY = 'power-match:ratios';
export function RatioMemory(storage = (() => { try { return globalThis.localStorage; } catch(e) { return undefined; } })()) {
    const read = () => { try { return JSON.parse(storage?.getItem(MEMORY_KEY) ?? '{}') ?? {}; } catch(e) { return {}; } };
    return {
        get(key) { const r = read()[key]?.ratio; return Number.isFinite(r) ? r : undefined; },
        set(key, ratio, at = Date.now()) {
            if(!key || !Number.isFinite(ratio)) return;
            const all = read();
            all[key] = {ratio: Math.round(ratio * 10000) / 10000, at};
            try { storage?.setItem(MEMORY_KEY, JSON.stringify(all)); } catch(e) {}
        },
    };
}
export const pairKey = (meter, trainer) => (meter && trainer ? `${meter}|${trainer}` : null);
const REMEMBER_AFTER = 120;   // s of paired samples before a ride's ratio is worth keeping
const REMEMBER_EVERY = 60000; // ms between saves while riding

// Wires the core to the app: reads db:powerTarget and the two power streams,
// writes trainer:powerTarget, which is what the trainer actually receives.
//
// The core learns whenever both devices are connected, whatever the power
// source is, so the offset is already known when the source is switched to
// the meter. `enabled` only decides whether the correction is applied.
//
// Debugging (Settings > Power Match Debug, or ?debug in the URL):
// - powerMatch:debug carries a snapshot on every meter sample and event
// - a log of those snapshots, downloadable as CSV
// - simulate(): fake trainer + meter streams, the trainer following what it
//   was commanded with a little ERG lag, the meter off by a set ratio, so the
//   whole loop runs with no hardware
// - window.powerMatch in the console
function PowerMatch(args = {}) {
    const core = PowerMatchCore(args);
    const now  = args.now ?? (() => Date.now());
    const memory = args.memory ?? RatioMemory();
    const names = {meter: null, trainer: null};
    let rememberedAt = 0;
    const key = () => pairKey(names.meter, names.trainer);
    // both devices named: start from what this pair settled on last time
    function onName(which) {
        return function(name) {
            names[which] = name && name !== '--' ? name : null;
            const k = key();
            if(k && !core.isReady()) { core.seed(memory.get(k)); record('seed'); }
        };
    }
    function remember(force = false) {
        const k = key();
        const st = core.state();
        if(!k || !st.ready || st.paired < REMEMBER_AFTER) return;
        if(!force && now() - rememberedAt < REMEMBER_EVERY) return;
        rememberedAt = now();
        memory.set(k, st.emaMeter / st.emaTrainer, now());
    }
    const maxRows = args.maxRows ?? 8 * 3600 * 2;

    let sources  = {};
    let enabled  = false;
    let target   = 0;
    let lastSent;
    let lastSentT = 0;
    let targetSince = now();  // when the target last changed
    let meterPower;
    let sim;              // {offset, power, timer}
    const log = [];

    function isEnabled() {
        if(exists(sim)) return true;
        return equals(sources.power, meterId) && (sources.powerMatch ?? true);
    }

    // ---------------------------------------------------------------- easing
    //
    // Paused, the trainer holds an easy load instead of the interval's watts,
    // and on resume it ramps back up (this fork, Nov 13, 2026, rider:
    // "getting started after a pause is really hard. I have to really juice
    // up the power a lot ... it should let me ease back in"). In ERG a
    // standstill against 286 W is a wall; against 100 W it is a pedal stroke.
    const EASE_FLOOR = args.easeFloor ?? 100;     // W while paused
    const EASE_MS    = args.easeMs ?? 20000;      // the ramp back up
    let watchState = 'stopped';
    let ramp = null;                              // {from, start, ms}
    let rampTimer;
    // Solo, a resume first ramps back with the clock still stopped
    // (watch.js RAMPBACK_S): the trainer climbs from the easy load to the
    // target while paused, and the clock restarts at the target, so no ease
    // follows. A group ride resumes at once and eases over EASE_MS as before.
    let rampingBack = false;
    let rampedBack = false;

    // Interval changes (this fork, Nov 13, 2026, rider: "when I start a new
    // interval ... Power Match has a lot of trouble ... I have to really
    // punch the pedals at the start of intervals"). For the first seconds
    // of a new target the trainer's ERG is still catching up and the rider
    // is spinning up, so the pedals and the trainer disagree for reasons
    // that have nothing to do with calibration. So after a change of 10 W+
    // the ratio is held: nothing learned and no corrections for 15 s, the
    // new target sent with the ratio already known. A step up of 30 W+
    // ramps in over 5 s instead of landing as a wall.
    const STEP_MIN_W   = args.stepMinW ?? 10;
    const STEP_HOLD_MS = args.stepHoldMs ?? 15000;
    const STEP_RAMP_W  = args.stepRampW ?? 30;
    const STEP_RAMP_MS = args.stepRampMs ?? 5000;
    let holdUntil = 0;

    function eased(value) {
        if(!(value > 0)) return value;
        if(watchState === 'paused' && !rampingBack) return Math.min(value, EASE_FLOOR);
        if(ramp) {
            const k = (now() - ramp.start) / ramp.ms;
            if(k >= 1) { ramp = null; return value; }
            const from = Math.min(ramp.from, value);
            return Math.round(from + (value - from) * k);
        }
        return value;
    }

    function startRamp(from, ms, event) {
        ramp = {from, start: now(), ms};
        send(event);
        clearInterval(rampTimer);
        rampTimer = setInterval(() => {
            send(ramp ? 'ease' : 'ease:done');
            if(!ramp) clearInterval(rampTimer);
        }, args.easeTick ?? 1000);
    }

    function isHolding() {
        return now() < holdUntil;
    }

    function onWatchStatus(state) {
        const was = watchState;
        watchState = state;
        if(state === 'paused' && was !== 'paused') {
            ramp = null;
            send('ease:paused');
        }
        if(state === 'started' && was !== 'started') {
            if(rampedBack) {
                // the ramp-back already brought the trainer up: the target, at once
                rampedBack = false;
                ramp = null;
                clearInterval(rampTimer);
                send('ease:rampback-done');
            } else {
                startRamp(Math.min(EASE_FLOOR, lastSent ?? EASE_FLOOR), EASE_MS, 'ease:resume');
            }
        }
        if(state === 'stopped') {
            ramp = null;
            clearInterval(rampTimer);
        }
    }

    function isEasing() {
        return watchState === 'paused' || !!ramp;
    }

    function trainerTarget() {
        return eased(enabled ? core.adjust(target) : target);
    }

    function snapshot(event = '') {
        const st = core.state();
        return {
            t:          now(),
            event,
            enabled,
            sim:        exists(sim),
            ready:      st.ready,
            paired:     st.paired,
            ratio:      st.ratio,
            target,
            sent:       lastSent ?? target,
            trainer:    st.trainer,
            meter:      meterPower,
            emaTrainer: st.emaTrainer,
            emaMeter:   st.emaMeter,
            source:     sources.power,
            steady:     Math.round((now() - targetSince) / 1000),
            calm:       calm().k,
            hold:       isHolding(),
        };
    }

    function record(event = '') {
        const row = snapshot(event);
        log.push(row);
        if(log.length > maxRows) log.shift();
        xf.dispatch('powerMatch:debug', row);
        return row;
    }

    function send(event = 'send') {
        const value = trainerTarget();
        lastSent  = value;
        lastSentT = now();
        xf.dispatch('trainer:powerTarget', value);
        status();
        record(event);
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

    function updateEnabled(event) {
        const next = isEnabled();
        if(equals(next, enabled)) return;
        enabled = next;
        send(event ?? (enabled ? 'enable' : 'disable'));
    }

    function onSources(value = {}) {
        sources = Object.assign({}, value);
        updateEnabled();
    }

    function calm() {
        return settle((now() - targetSince) / 1000, target, args);
    }

    function onPowerTarget(value) {
        const was = target;
        // a new interval resets the settling; a ramp's small steps (or a +5)
        // do not, so a sloped warm-up is not chased as if every 10 s were a
        // new interval: each step still goes out at the ratio already learned
        if(value !== was && Math.abs(value - was) >= STEP_MIN_W) targetSince = now();
        target = value;
        if(Math.abs(value - was) >= STEP_MIN_W) {
            holdUntil = now() + STEP_HOLD_MS;
            core.breakPair();
        }
        if(was > 0 && value - was >= STEP_RAMP_W && watchState === 'started' && !ramp) {
            startRamp(lastSent ?? was, STEP_RAMP_MS, 'step:ramp');
            return;
        }
        send('target');
    }

    function onRampback(r) {
        if(r && !r.done) {
            if(rampingBack) return;
            rampingBack = true;
            rampedBack = false;
            startRamp(Math.min(EASE_FLOOR, lastSent ?? EASE_FLOOR), (r.total ?? 10) * 1000, 'ease:rampback');
            return;
        }
        rampingBack = false;
        if(r && r.done) {
            rampedBack = true;
            return;
        }
        // cancelled: back to the easy load
        ramp = null;
        clearInterval(rampTimer);
        send('ease:paused');
    }

    function onTrainerPower(power) {
        core.onTrainer(power, now());
    }

    function onMeterPower(power) {
        meterPower = power;
        core.observe(power, now());
        const c = calm();
        if(isHolding()) {
            status();
            record();
            return;
        }
        core.onMeter(power, now(), c.tau);
        remember();

        if(enabled && target > 0 && core.isReady() && !isEasing()) {
            const value = core.adjust(target);
            if(shouldCorrect(value - (lastSent ?? target), now() - lastSentT, c, args)) {
                send('correct');
                return;
            }
        }
        status();
        record();
    }

    function onDisconnect(event) {
        return function() {
            if(exists(sim)) return;
            core.reset();
            meterPower = undefined;
            send(event);
        };
    }

    // simulation
    function noise(amplitude) {
        return (Math.random() * 2 - 1) * amplitude;
    }

    function simTick() {
        const commanded = lastSent ?? target;
        const goal = commanded > 0 ? commanded : 150;
        sim.power += 0.5 * (goal - sim.power);
        xf.dispatch(`${trainerId}:power`, Math.round(sim.power + noise(3)));
        xf.dispatch(`${meterId}:power`,   Math.round(sim.power * sim.offset + noise(5)));
    }

    function simulate(on = true, opts = {}) {
        if(on) {
            const offset = Number(opts.offset ?? sim?.offset ?? 1.03);
            if(exists(sim)) {
                sim.offset = offset;
                record('sim:offset');
                return;
            }
            core.reset();
            sim = {offset, power: target > 0 ? target : 150, timer: undefined};
            sim.timer = setInterval(simTick, args.simInterval ?? 1000);
            updateEnabled('sim:start');
            record('sim:start');
        } else if(exists(sim)) {
            clearInterval(sim.timer);
            sim = undefined;
            core.reset();
            meterPower = undefined;
            enabled = isEnabled();
            send('sim:stop');
        }
    }

    function isSimulating() {
        return exists(sim);
    }

    // log export
    const columns = [
        't', 'time', 'event', 'enabled', 'sim', 'ready', 'paired', 'ratio',
        'target', 'sent', 'trainer', 'meter', 'emaTrainer', 'emaMeter', 'source',
        'steady', 'calm', 'hold',
    ];

    function fmt(value) {
        if(!exists(value)) return '';
        if(typeof value === 'number' && !Number.isInteger(value)) {
            return value.toFixed(4);
        }
        return String(value);
    }

    function csv() {
        const lines = [columns.join(',')];
        for(const row of log) {
            const r = Object.assign({}, row, {time: new Date(row.t).toISOString()});
            lines.push(columns.map(c => fmt(r[c])).join(','));
        }
        return lines.join('\n') + '\n';
    }

    function download() {
        const blob = new Blob([csv()], {type: 'text/csv'});
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.href = URL.createObjectURL(blob);
        a.download = `power-match-${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function clear() {
        log.length = 0;
        record('clear');
    }

    let abortController;

    function start() {
        abortController = new AbortController();
        const signal = { signal: abortController.signal };

        xf.sub('db:sources',                  onSources, signal);
        xf.sub('db:powerTarget',              onPowerTarget, signal);
        xf.sub(`${trainerId}:power`,          onTrainerPower, signal);
        xf.sub(`${meterId}:power`,            onMeterPower, signal);
        xf.sub(`${meterId}:disconnected`,     onDisconnect('meter:disconnect'), signal);
        xf.sub(`${trainerId}:disconnected`,   onDisconnect('trainer:disconnect'), signal);
        xf.sub('db:watchStatus',              onWatchStatus, signal);
        xf.sub('watch:rampback',              onRampback, signal);
        xf.sub(`${meterId}:name`,             onName('meter'), signal);
        xf.sub(`${trainerId}:name`,           onName('trainer'), signal);
        xf.sub('watch:stopped',               () => remember(true), signal);
    }

    function stop() {
        clearInterval(rampTimer);
        simulate(false);
        abortController?.abort();
    }

    return Object.freeze({
        start,
        stop,
        core,
        trainerTarget,
        isEasing,
        snapshot,
        simulate,
        isSimulating,
        log: () => log,
        csv,
        download,
        clear,
    });
}

const powerMatch = PowerMatch();
powerMatch.start();

if(typeof window !== 'undefined') {
    window.powerMatch = powerMatch;
}

export default powerMatch;

export {
    PowerMatchCore,
    PowerMatch,
    settle,
    shouldCorrect,
};
