//
// What the workout asks for next, from the step running and its time left.
// The live chart draws it (views/live-chart.js); Power Match starts the
// trainer towards it a moment early (power-match.js, the lead).
//

import { exists } from './functions.js';
import { models } from './models/models.js';

// The workout's targets from now on, for `seconds`: [{from, to, w}] in
// seconds from now. The step running keeps its live target (a nudge, the
// workout's %), for the `stepLeft` seconds it has left; later steps are
// FTP × step % × intensity %, as watch.js sets them. A step with no power
// (a SIM step) is a gap; one with no duration (a distance step) ends it.
export function ahead({workout, iv, st, stepLeft, target, ftp, intensity = 100, seconds}) {
    const intervals = workout?.intervals;
    if(!intervals?.[iv]?.steps?.[st] || !(seconds > 0)) return [];
    const out = [];
    let t = Math.max(0, stepLeft || 0);
    if(t > 0 && target > 0) out.push({from: 0, to: Math.min(t, seconds), w: target});
    let i = iv, j = st + 1;
    while(t < seconds && i < intervals.length) {
        const steps = intervals[i]?.steps ?? [];
        if(j >= steps.length) { i += 1; j = 0; continue; }
        const step = steps[j];
        const d = step?.duration;
        if(!(d > 0)) break;
        const w = exists(step.power) ? Math.round(models.ftp.toAbsolute(step.power, ftp) * intensity / 100) : 0;
        if(w > 0) {
            const prev = out[out.length - 1];
            // one block per target: a ramp's stair stays stairs, a repeat of
            // the same watts across steps is one block
            if(prev && prev.w === w && prev.to === t) prev.to = Math.min(t + d, seconds);
            else out.push({from: t, to: Math.min(t + d, seconds), w});
        }
        t += d;
        j += 1;
    }
    return out;
}

// the first change of target in ahead()'s blocks: a new block, or the gap
// after the step running (a SIM step, the end of the workout: w 0)
export function nextChange(blocks) {
    if(!blocks.length) return null;
    const first = blocks[0];
    if(first.from > 0) return {from: first.from, w: first.w};
    const second = blocks[1];
    if(second && second.from === first.to) return {from: second.from, w: second.w};
    return {from: first.to, w: 0};
}
