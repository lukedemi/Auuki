//
// Live samples: one row a second while the timer runs, for the live charts.
//
// {t: elapsed s, w: power (the chosen source, 1 s), hr, target: the
// workout's power target, iv / st: the workout's interval and step that
// second, -1 when no workout is running — the plan the ride was meant to
// follow, for the end screen's image}. The live chart in the Graph panel and the actual
// power drawn over the workout graph both read from here. A new ride (the
// clock going backwards) starts a fresh buffer; stopping keeps the last one
// on screen.
//

import { xf, exists } from './functions.js';

function LiveSamples(args = {}) {
    const max = args.max ?? 12 * 3600;
    let samples = [];
    const latest = { w: 0, hr: 0, target: 0, bal: null, iv: 0, st: 0, workout: 'stopped' };

    function onElapsed(t) {
        if(!exists(t) || t <= 0) return;
        const last = samples[samples.length - 1];
        if(last && t < last.t) samples = [];
        if(last && t === last.t && samples.length) return;
        const inWorkout = latest.workout === 'started';
        samples.push({ t, w: latest.w ?? 0, hr: latest.hr ?? 0, target: latest.target ?? 0, bal: latest.bal,
                       iv: inWorkout ? latest.iv : -1, st: inWorkout ? latest.st : -1 });
        if(samples.length > max) samples.shift();
        xf.dispatch('live:sample', samples);
    }

    // a reloaded ride: one record a second, in order (models.js Session)
    function onRestore(records = []) {
        if(samples.length) return;
        samples = records.map((r, i) => ({ t: i + 1, w: r.power ?? 0, hr: r.heart_rate ?? 0, target: 0,
            bal: (r.left_right_balance ?? 0xFF) === 0xFF ? null : 100 - (r.left_right_balance & 0x7F) }));
        xf.dispatch('live:sample', samples);
    }

    function start() {
        xf.sub('live:restore',   onRestore);
        xf.sub('db:power1s',     (v) => latest.w = v);
        xf.sub('db:heartRate',   (v) => latest.hr = v);
        xf.sub('db:powerTarget', (v) => latest.target = v);
        xf.sub('db:balance',     (v) => latest.bal = v);
        xf.sub('db:intervalIndex', (v) => latest.iv = v);
        xf.sub('db:stepIndex',     (v) => latest.st = v);
        xf.sub('db:workoutStatus', (v) => latest.workout = v);
        xf.sub('watch:elapsed',  onElapsed);
    }

    return Object.freeze({
        start,
        onElapsed,
        onRestore,
        latest,
        all: () => samples,
        reset: () => { samples = []; xf.dispatch('live:sample', samples); },
    });
}

const liveSamples = LiveSamples();
liveSamples.start();

export default liveSamples;
export { LiveSamples };
