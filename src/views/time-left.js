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
