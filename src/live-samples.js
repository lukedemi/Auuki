//
// Live samples: one row a second while the timer runs, for the live charts.
//
// {t: elapsed s, w: power (the chosen source, 1 s), hr, target: the
// workout's power target}. The live chart in the Graph panel and the actual
// power drawn over the workout graph both read from here. A new ride (the
// clock going backwards) starts a fresh buffer; stopping keeps the last one
// on screen.
//

import { xf, exists } from './functions.js';

function LiveSamples(args = {}) {
    const max = args.max ?? 12 * 3600;
    let samples = [];
    const latest = { w: 0, hr: 0, target: 0 };

    function onElapsed(t) {
        if(!exists(t) || t <= 0) return;
        const last = samples[samples.length - 1];
        if(last && t < last.t) samples = [];
        if(last && t === last.t && samples.length) return;
        samples.push({ t, w: latest.w ?? 0, hr: latest.hr ?? 0, target: latest.target ?? 0 });
        if(samples.length > max) samples.shift();
        xf.dispatch('live:sample', samples);
    }

    function start() {
        xf.sub('db:power1s',     (v) => latest.w = v);
        xf.sub('db:heartRate',   (v) => latest.hr = v);
        xf.sub('db:powerTarget', (v) => latest.target = v);
        xf.sub('watch:elapsed',  onElapsed);
    }

    return Object.freeze({
        start,
        onElapsed,
        latest,
        all: () => samples,
        reset: () => { samples = []; xf.dispatch('live:sample', samples); },
    });
}

const liveSamples = LiveSamples();
liveSamples.start();

export default liveSamples;
export { LiveSamples };
