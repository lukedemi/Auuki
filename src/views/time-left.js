//
// Time Left and Finish, in place of Speed and Distance on the home page
// (this fork, Nov 13, 2026, rider: "replace speed and distance on here with
// time left and finish time, like the time of day I'll be done").
//
// Time left is what remains of the workout: the rest of this interval
// (lapTime counts down once the workout is running) plus every interval
// after it; before the workout starts, all of it. Finish is now + time
// left on the clock, so it slides later while paused. A workout without
// durations (a course) shows "--".
//

import { xf, exists } from '../functions.js';
import { formatTime } from '../utils.js';
import liveSamples from '../live-samples.js';

export function remainingSeconds({intervals = [], index = 0, lapTime = 0, workoutStatus = 'stopped'} = {}) {
    if(!intervals.length || intervals.some((i) => !Number.isFinite(i?.duration))) return null;
    if(workoutStatus === 'done') return 0;
    if(workoutStatus !== 'started') return intervals.reduce((a, i) => a + i.duration, 0);
    const after = intervals.slice(index + 1).reduce((a, i) => a + i.duration, 0);
    return Math.max(0, (lapTime ?? 0) + after);
}

export function clockAt(ms) {
    return new Date(ms).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
}

const state = {intervals: [], index: 0, lapTime: 0, workoutStatus: 'stopped'};
let subscribed = false;
function subscribe() {
    if(subscribed) return;
    subscribed = true;
    xf.sub('db:workout',       (w) => { state.intervals = w?.intervals ?? []; xf.dispatch('time-left:update'); });
    xf.sub('db:intervalIndex', (i) => { state.index = i ?? 0; });
    xf.sub('db:lapTime',       (t) => { state.lapTime = t ?? 0; xf.dispatch('time-left:update'); });
    xf.sub('db:workoutStatus', (s) => { state.workoutStatus = s ?? 'stopped'; xf.dispatch('time-left:update'); });
}

class TimeLeft extends HTMLElement {
    connectedCallback() {
        subscribe();
        this.abortController = new AbortController();
        xf.sub('time-left:update', () => this.render(), {signal: this.abortController.signal});
        this.render();
    }
    disconnectedCallback() { this.abortController.abort(); }
    render() {
        const s = remainingSeconds(state);
        this.textContent = s === null ? '--:--' : formatTime({value: s, format: s >= 3600 ? 'hh:mm:ss' : 'mm:ss', unit: 'seconds'});
    }
}

class FinishTime extends HTMLElement {
    connectedCallback() {
        subscribe();
        this.abortController = new AbortController();
        xf.sub('time-left:update', () => this.render(), {signal: this.abortController.signal});
        // the clock moves on its own, and a paused ride finishes later
        this.timer = setInterval(() => this.render(), 15000);
        this.render();
    }
    disconnectedCallback() { this.abortController.abort(); clearInterval(this.timer); }
    render() {
        const s = remainingSeconds(state);
        this.textContent = s === null ? '--:--' : clockAt(Date.now() + s * 1000);
    }
}

customElements.define('time-left', TimeLeft);
customElements.define('finish-time', FinishTime);

// Total kJ of the ride so far, in place of Slope (always 0.0 in ERG; rider,
// Nov 13, 2026): the sum of each second's power (live-samples.js), so a
// reloaded ride counts what was saved.

export function totalKj(samples = []) {
    return Math.round(samples.reduce((a, r) => a + (r.w || 0), 0) / 1000);
}

class WorkKj extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        xf.sub('live:sample', (samples) => this.render(samples), {signal: this.abortController.signal});
        this.render(liveSamples.all());
    }
    disconnectedCallback() { this.abortController.abort(); }
    render(samples = []) {
        this.textContent = samples.length ? String(totalKj(samples)) : '--';
    }
}

customElements.define('work-kj', WorkKj);

// TSS so far (rider, Nov 13, 2026: "throw TSS in there, even if it's pretty
// small next to something"), shown small in the Work tile's heading.
// The standard arithmetic on one sample a second: NP is the fourth-power
// mean of the 30 s rolling average, IF = NP / FTP, and
// TSS = seconds x NP x IF / (FTP x 3600) x 100.
export function normalizedPower(watts = []) {
    if(!watts.length) return 0;
    const n = 30;
    let sum = 0, acc = 0, count = 0;
    for(let i = 0; i < watts.length; i++) {
        sum += watts[i] || 0;
        if(i >= n) sum -= watts[i - n] || 0;
        if(i >= n - 1 || watts.length < n) {
            const avg = sum / Math.min(i + 1, n);
            acc += avg ** 4;
            count++;
        }
    }
    return count ? (acc / count) ** 0.25 : 0;
}

export function tss(watts = [], ftp = 0) {
    if(!(ftp > 0) || !watts.length) return 0;
    const np = normalizedPower(watts);
    return watts.length * np * (np / ftp) / (ftp * 3600) * 100;
}

let tssFtp = 0;
let tssSubscribed = false;

class TssValue extends HTMLElement {
    connectedCallback() {
        if(!tssSubscribed) {
            tssSubscribed = true;
            xf.sub('db:ftp', (v) => { tssFtp = v; xf.dispatch('tss:update'); });
        }
        this.abortController = new AbortController();
        const signal = {signal: this.abortController.signal};
        xf.sub('live:sample', (samples) => this.render(samples), signal);
        xf.sub('tss:update', () => this.render(liveSamples.all()), signal);
        this.render(liveSamples.all());
    }
    disconnectedCallback() { this.abortController.abort(); }
    render(samples = []) {
        this.textContent = samples.length && tssFtp > 0 ? String(Math.round(tss(samples.map((r) => r.w || 0), tssFtp))) : '--';
    }
}

customElements.define('tss-value', TssValue);
