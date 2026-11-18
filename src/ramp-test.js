//
// The ramp test, run as a test (rider, Nov 18, 2026: "I feel like the ramp
// test needs special treatment").
//
// The workout (workouts.js RAMP_TEST) climbs 5% of FTP a minute with no top.
// While it climbs this watches the rider, once a second:
//
//   failure   in ERG the power holds and the legs give: cadence under 50 rpm
//             for 8 s, or power under 70% of the step for 10 s, or the ride
//             auto-pausing, or "I'm done" on the panel (views/ramp-test-view.js)
//   then      straight into the cool-down (ui:watchJump), and the result: the
//             best minute and FTP ≈ 75% of it, with a button to set it
//
// Live, the panel shows the step, its target, the time to the next one, and
// the FTP the best minute so far points to.
//
import { xf } from './functions.js';
import { RAMP_TEST } from './workouts/workouts.js';

export const SHARE = 0.75;          // FTP from the best minute
export const LOW_CADENCE = 50;      // rpm
export const LOW_CADENCE_S = 8;
export const LOW_POWER = 0.7;       // of the step's target
export const LOW_POWER_S = 10;

// the best average over `window` seconds of one-a-second samples
export function bestAverage(samples, window = 60) {
    if(samples.length < window) return 0;
    let sum = 0, best = 0;
    for(let i = 0; i < samples.length; i++) {
        sum += samples[i] || 0;
        if(i >= window) sum -= samples[i - window] || 0;
        if(i >= window - 1) best = Math.max(best, sum / window);
    }
    return Math.round(best);
}

// fed once a second; says when the rider can no longer hold the ramp
export function FailureWatch({lowCadence = LOW_CADENCE, lowCadenceS = LOW_CADENCE_S, lowPower = LOW_POWER, lowPowerS = LOW_POWER_S} = {}) {
    let slow = 0, weak = 0, sawCadence = false;
    return {
        tick({cadence, power, target}) {
            if(cadence > 0) sawCadence = true;
            // without a cadence reading at all, only power can say it
            slow = sawCadence && !(cadence >= lowCadence) ? slow + 1 : 0;
            weak = target > 0 && !(power >= target * lowPower) ? weak + 1 : 0;
            return slow >= lowCadenceS || weak >= lowPowerS;
        },
        reset() { slow = 0; weak = 0; },
    };
}

// which intervals are the ramp: its one-minute steps; the cool-down is the last
export function rampIntervals(workout) {
    const ivs = workout?.intervals ?? [];
    const idx = ivs.map((iv, i) => ((iv.steps ?? []).length === 1 && Number(iv.steps[0].duration) === 60 ? i : -1)).filter((i) => i >= 0);
    return idx.length ? {first: idx[0], last: idx[idx.length - 1], cooldown: ivs.length - 1} : null;
}

export const isRampTest = (workout) => workout?.meta?.name === RAMP_TEST;

function RampTest() {
    const live = {workout: null, ramp: null, interval: 0, power: 0, cadence: 0, target: 0, ftp: 0, stepTime: 0, status: 'stopped'};
    let samples = [], watch = FailureWatch(), state = 'idle';   // idle · ramping · done

    const reset = () => { samples = []; watch = FailureWatch(); state = 'idle'; };
    const inRamp = () => live.ramp && live.interval >= live.ramp.first && live.interval <= live.ramp.last;

    function status() {
        const best = bestAverage(samples);
        const step = live.ramp ? live.interval - live.ramp.first + 1 : 0;
        xf.dispatch('ramp-test:status', {
            state, step, target: Math.round(live.target), nextIn: live.stepTime, best,
            ftp: best ? Math.round(best * SHARE) : 0, seconds: samples.length,
        });
    }

    function finish(why) {
        if(state !== 'ramping') return;
        state = 'done';
        const best = bestAverage(samples);
        const peakStep = live.ramp ? live.interval - live.ramp.first + 1 : 0;
        if(live.ramp && live.interval <= live.ramp.last) xf.dispatch('ui:watchJump', live.ramp.cooldown);
        xf.dispatch('ramp-test:result', {
            why, best, ftp: best ? Math.round(best * SHARE) : 0, current: live.ftp,
            peak: Math.round(Math.max(...samples.slice(-30), 0)), steps: peakStep, seconds: samples.length,
        });
        status();
    }

    xf.sub('db:workout', (w) => { live.workout = w; live.ramp = isRampTest(w) ? rampIntervals(w) : null; reset(); status(); });
    xf.sub('db:intervalIndex', (i) => {
        live.interval = i;
        if(!live.ramp) return;
        if(state === 'idle' && inRamp() && live.status === 'started') state = 'ramping';
        // climbed off the top of the ramp: that is a finish too
        if(state === 'ramping' && i > live.ramp.last) finish('top');
        watch.reset();
    });
    xf.sub('db:power', (v) => { live.power = v; });
    xf.sub('db:cadence', (v) => { live.cadence = v; });
    xf.sub('db:powerTarget', (v) => { live.target = v; });
    xf.sub('db:ftp', (v) => { live.ftp = v; });
    xf.sub('db:stepTime', (v) => { live.stepTime = v; });
    xf.sub('db:watchStatus', (v) => { live.status = v; if(state === 'idle' && inRamp() && v === 'started') state = 'ramping'; });
    xf.sub('watch:elapsed', () => {
        if(!live.ramp) return;
        if(state === 'idle' && inRamp() && live.status === 'started') state = 'ramping';
        if(state !== 'ramping' || !inRamp()) return;
        samples.push(Number(live.power) || 0);
        if(watch.tick({cadence: Number(live.cadence) || 0, power: Number(live.power) || 0, target: Number(live.target) || 0})) finish('failed');
        else status();
    });
    // auto-pause in the ramp: the rider stopped
    xf.sub('watch:paused', () => { if(state === 'ramping') finish('stopped'); });
    xf.sub('watch:stopped', () => { if(state === 'ramping') finish('stopped'); reset(); status(); });
    xf.sub('ui:ramp-test:end', () => finish('ended'));
    xf.sub('ui:ramp-test:set-ftp', (ftp) => { if(ftp > 0) xf.dispatch('ui:ftp-set', ftp); });
    return {status: () => ({state, samples: samples.length})};
}

export { RampTest };
const rampTest = (typeof window !== 'undefined' && !globalThis.__AUUKI_NO_RAMPTEST__) ? RampTest() : null;
export default rampTest;
