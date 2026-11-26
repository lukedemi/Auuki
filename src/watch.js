import { equals, exists, empty, first, last, xf, avg, max, toFixed, print, } from './functions.js';
import { pedallingThroughPause, RESUME_AFTER_S } from './pause-resume.js';
import { kphToMps, mpsToKph, timeDiff, pad } from './utils.js';
import { models } from './models/models.js';
import { ControlMode, } from './ble/enums.js';
import { TimerStatus, EventType, } from './activity/enums.js';
import { extendInterval } from './workouts/extend.js';
import { isLapInstruction } from './workouts/zwo.js';

// const timer = new Worker('./timer.js');
const timer = new Worker(new URL('./timer.js', import.meta.url));

const AUTO_PAUSE_W = 20;   // under this is stopped
const AUTO_PAUSE_S = 3;    // for this many seconds

// Back from a pause, solo (rider, Nov 26, 2026: "by default, it's 10 seconds of
// time to get you back, but it doesn't count towards your actual workout. And
// it shows it very clearly on screen. Ramping back to X watts, and it has a
// countdown. And then it plops you right back into the workout at your
// correct watts, so you don't have a visual gash on your workout"). Resuming
// a paused workout first runs this many seconds with the clock still stopped
// while the trainer ramps up (power-match.js), then the clock restarts at the
// interval's own watts; nothing is recorded meanwhile, so the ride has no dip.
// Solo only: a group ride's clock is everyone's (doc/solo-and-group.md).
export const RAMPBACK_S = 10;

class Watch {
    constructor(args) {
        this.elapsed          = 0;
        this.lapTime          = 0;
        this.stepTime         = 0;

        this.intervalIndex    = 0;
        this.stepIndex        = 0;
        this.intervalDuration = 0;
        this.stepDuration     = 0;

        this.state            = 'stopped';
        this.stateWorkout     = 'stopped';

        // Distance
        this.intervalType      = 'duration';
        // end Distance

        this.intervals         = [];
        this.textEvents        = [];
        this.textEvent         = '';
        this.workoutType       = "workout";
        this.autoStartCounter  = 3;
        this.autoPauseCounter  = 0;
        this.hasBeenAutoPaused = false;
        this.autoPause         = true;
        this.autoStart         = true;
        // a group ride (group/group.js) moves the workout by the group's
        // clock; the watch only records
        this.groupMode         = false;
        this.rampback          = null;     // {left} while a solo resume ramps back
        this.donePrompt        = false;    // the workout ended: paused, asking finish or ride on
        this.init();
    }
    init() {
        const self = this;

        // Data subs
        xf.sub('db:elapsed',       elapsed => { self.elapsed       = elapsed; });
        xf.sub('db:lapTime',          time => { self.lapTime       = time; });
        xf.sub('db:stepTime',         time => { self.stepTime      = time; });
        xf.sub('db:intervalDuration', time => { self.lapDuration   = time; });
        xf.sub('db:stepDuration',     time => { self.stepDuration  = time; });
        xf.sub('db:intervalIndex',   index => { self.intervalIndex = index; });
        xf.sub('db:stepIndex',       index => { self.stepIndex     = index; });
        xf.sub('db:watchStatus',     state => {
            if(state === 'paused' && self.state !== 'paused') self.pausedAt = Date.now();
            self.state = state;
        });
        xf.sub('db:cadence',         rpm => { self.cadence = rpm; });
        xf.sub('db:groupMode',          on => { self.groupMode     = on; });
        xf.sub('db:workoutStatus',   state => {
            self.stateWorkout = state;

            if(!self.isWorkoutStarted()) {
                self.dispatchTextEvent();
            }

            if(self.isWorkoutDone()) {
                xf.dispatch('watch:lap');
                // reset to slope mode 0% when workout is done; a group ride
                // goes on into its cooldown in ERG, at the last target
                if(!self.groupMode) {
                    xf.dispatch('ui:slope-target-set', 0);
                    xf.dispatch('ui:mode-set', ControlMode.sim);
                    // solo, the clock stops with the workout and asks
                    if(self.isStarted()) self.finishPrompt();
                }
                console.log(`Workout done!`);
            }
        });
        xf.sub('db:workout',       workout => {
            self.intervals  = workout.intervals;
            self.textEvents = flattenMessages(self.intervals);
            if(workout.meta.category?.toLowerCase().includes("test")) {
                self.workoutType = "test";
                // force turn off auto pausing for Test Category workouts
                xf.dispatch(`sources`, {autoPause: false});
            } else {
                self.workoutType = "workout";
            }
            console.log(`:workout :type ${self.workoutType}`);
            self.dispatchTextEvent();
        });
        xf.sub('db:power1s', self.onPower1s.bind(this));
        xf.sub('db:sources', self.onSources.bind(this));
        timer.addEventListener('message', self.onTick.bind(self));

        // UI subs
        xf.sub('ui:workoutStart', e => { self.startWorkout();   });
        xf.sub('ui:watchStart',   e => { self.start();          });
        xf.sub('workout:restore', e => { self.restoreWorkout(); });
        xf.sub('ui:watchPause',   e => { self.pause();          });
        xf.sub('ui:watchResume',  e => { self.resume();         });
        xf.sub('ui:keep-riding',  e => { self.keepRiding();     });
        xf.sub('ui:rampback-skip', e => { self.finishRampback(); });
        xf.sub('ui:watchLap',     e => { self.lap();            });
        xf.sub('ui:watchBack',    e => { self.back();           });
        xf.sub('ui:watchJump',    i => { self.jump(i);          });
        // the pause screen's End workout, which asks for itself
        xf.sub('ui:watchEnd',     e => { self.stop();           });
        xf.sub('ui:watchStop',    e => {
            const stop = confirm('Confirm Stop?');
            if(stop) {
                self.stop();
            }
        });
    }
    isStarted()        { return this.state        === 'started'; };
    isPaused()         { return this.state        === 'paused'; };
    isStopped()        { return this.state        === 'stopped'; };
    isWorkoutStarted() { return this.stateWorkout === 'started'; };
    isWorkoutDone()    { return this.stateWorkout === 'done'; };
    isIntervalType(type) {
        return equals(this.intervalType, type);
    }
    status() {
        return this.state;
    }
    isPedallingThroughPause(power, now = Date.now()) {
        return pedallingThroughPause({power, cadence: this.cadence, pausedAt: this.pausedAt, now});
    }
    onSources(value) {
        this.autoPause = value.autoPause ?? this.autoPause;
        this.autoStart = value.autoStart ?? this.autoStart;
    }
    // Auto-pause (this fork, Nov 13, 2026, rider: "way too slow or not
    // working at all"): it waited for four 1 s readings of exactly 0 W, and a
    // coasting trainer or pedal rarely reads exactly 0. Now: 3 s under 20 W.
    // power1s itself drops to 0 once the sensors go quiet (models.js).
    onPower1s(power) {
        if(this.autoPause) {
            if(power < AUTO_PAUSE_W && this.isStarted()) {
                this.autoPauseCounter += 1;
            } else {
                this.autoPauseCounter = 0;
            }

            if(this.autoPauseCounter >= AUTO_PAUSE_S) {
                this.autoPauseCounter = 0;
                xf.dispatch(`ui:watchPause`);
                this.hasBeenAutoPaused = true;
            }

            if(power > 40 && this.hasBeenAutoPaused) {
                xf.dispatch(`ui:watchResume`);
            }

            // Pedalling through a pause you set yourself (or one a reload
            // left): resume after a few seconds of it, counted down on the
            // pause banner (this fork, Nov 13, 2026, rider: "you can sit there
            // grinding for way too long"). Auto-pauses still resume at once.
            if(this.isPaused() && !this.hasBeenAutoPaused && !this.rampback && !this.donePrompt) {
                if(this.isPedallingThroughPause(power)) {
                    this.pausedPedalling = (this.pausedPedalling ?? 0) + 1;
                    const left = RESUME_AFTER_S - this.pausedPedalling;
                    xf.dispatch('watch:resume-countdown', Math.max(0, left));
                    if(left <= 0) {
                        this.pausedPedalling = 0;
                        xf.dispatch(`ui:watchResume`);
                    }
                } else if(this.pausedPedalling) {
                    this.pausedPedalling = 0;
                    xf.dispatch('watch:resume-countdown', null);
                }
            }
        }

        if(this.autoStart && this.isStopped()) {
            // check
            if(this.autoStartCounter < 0) return;
            if(this.autoStartCounter === 0) {
                this.autoStartCounter = -1;
                xf.dispatch(`ui:watchStart`);
                // in a group ride the workout starts at the group's time
                if(!this.groupMode) xf.dispatch('ui:workoutStart');
                xf.dispatch(`ui:autoStartCounter`, -1);
                return;
            }
            // update
            if(power === 0) {
                this.autoStartCounter = 3;
                xf.dispatch(`ui:autoStartCounter`, this.autoStartCounter);
            }
            if(power > 40) {
                this.autoStartCounter -= 1;
                xf.dispatch(`ui:autoStartCounter`, this.autoStartCounter);
            }
        }
    }
    // a paused workout, solo: ramp back with the clock stopped first
    shouldRampBack() {
        return this.isPaused() && this.isWorkoutStarted() && !this.groupMode && RAMPBACK_S > 0;
    }
    startRampback() {
        const self = this;
        if(self.rampback) return;          // already on its way back
        self.rampback = {left: RAMPBACK_S};
        self.pausedPedalling = 0;
        xf.dispatch('watch:resume-countdown', null);
        xf.dispatch('watch:rampback', {left: RAMPBACK_S, total: RAMPBACK_S});
        self.rampbackTimer = setInterval(() => {
            if(!self.rampback) return;
            self.rampback.left -= 1;
            if(self.rampback.left <= 0) self.finishRampback();
            else xf.dispatch('watch:rampback', {left: self.rampback.left, total: RAMPBACK_S});
        }, 1000);
    }
    finishRampback() {
        const self = this;
        if(!self.rampback) return;
        clearInterval(self.rampbackTimer);
        self.rampback = null;
        xf.dispatch('watch:rampback', {left: 0, total: RAMPBACK_S, done: true});
        self.resumeNow();
    }
    cancelRampback() {
        const self = this;
        if(!self.rampback) return false;
        clearInterval(self.rampbackTimer);
        self.rampback = null;
        xf.dispatch('watch:rampback', null);
        return true;
    }
    // The end of a solo workout (rider, Nov 26, 2026: "just finished the
    // workout and it continued to run like as if I wanted to keep going. But
    // that should never be the case. When I'm done the workout, it should say,
    // congratulations, and pop up. You should be able to click, no, I want to
    // do more"). The clock stops on the last second of the last step, so the
    // ride's time is the workout's; views/workout-done.js asks: Finish & save
    // (ui:watchEnd, the ride saved and the end screen opened) or Keep riding
    // (the clock on again, a free ride in SIM). Pedalling while it asks does
    // not resume anything. A group ride goes on into the group's cool-down.
    finishPrompt() {
        const self = this;
        if(self.donePrompt) return;
        self.donePrompt = true;
        self.pausedPedalling = 0;
        self.pause();
        xf.dispatch('watch:done-prompt', true);
    }
    keepRiding() {
        const self = this;
        if(!self.donePrompt) return;
        self.donePrompt = false;
        xf.dispatch('watch:done-prompt', false);
        self.resumeNow();
    }
    start() {
        const self = this;
        // ▶ or Space while the end of the workout asks: keep riding
        if(self.donePrompt) return self.keepRiding();
        // ▶ or Space again while ramping back: skip the rest of it
        if(self.rampback) return self.finishRampback();
        if(self.shouldRampBack()) return self.startRampback();
        if(self.isStarted() && !self.isWorkoutStarted()) {
            self.pause();
        } else {
            timer.postMessage('start');
            xf.dispatch('watch:started');

            xf.dispatch('watch:event', {
                timestamp: Date.now(),
                type: EventType.start,
            });
        }
    }
    startWorkout() {
        const self = this;

        // the group's clock starts a group ride's workout (group/group.js)
        if(self.groupMode) return;

        // in case of pressing play button during auto start countdown
        this.autoStartCounter = -1;
        xf.dispatch(`ui:autoStartCounter`, -1);

        if(self.isWorkoutStarted() || (
            // check for intervalIndex allows for multiple workouts in one session
            self.isWorkoutDone() && self.intervalIndex > 0
        )) {
            return;
        }

        let intervalTime = 0;
        let stepTime     = 0;

        if(exists(self.intervals)) {
            intervalTime = self.intervals[0]?.duration ?? 0;
            stepTime     = self.intervals[0]?.steps[0].duration ?? 0;

            xf.dispatch('watch:intervalIndex',  0);
            xf.dispatch('watch:stepIndex', 0);

            xf.dispatch('workout:started');

            xf.dispatch('watch:intervalDuration', intervalTime);
            xf.dispatch('watch:stepDuration',     stepTime);
            xf.dispatch('watch:lapTime',          intervalTime);
            xf.dispatch('watch:stepTime',         stepTime);
        }

        if(exists(self.points)) {
            self.intervalType = 'distance';
        }

        if(!self.isStarted()) {
            self.start();
        }

        self.dispatchTextEvent();
    }
    restoreWorkout() {
        const self = this;

        if(self.isWorkoutStarted()) {
            xf.dispatch('workout:started');
        }
        if(self.isStarted()) {
            self.pause();
        }
    }
    resume() {
        const self = this;
        if(self.donePrompt) return;             // only Keep riding resumes after the end
        if(self.shouldRampBack()) return self.startRampback();
        self.resumeNow();
    }
    resumeNow() {
        const self = this;
        if(!self.isStarted()) {
            timer.postMessage('start');
            xf.dispatch('watch:started');

            xf.dispatch('watch:event', {
                timestamp: Date.now(),
                type: EventType.start,
            });

            this.hasBeenAutoPaused = false;
        }
    }
    pause() {
        const self = this;
        // pausing again while ramping back: stay paused, the ramp is off
        if(self.cancelRampback()) return;
        timer.postMessage('pause');
        xf.dispatch('watch:paused');

        xf.dispatch('watch:event', {
            timestamp: Date.now(),
            type: EventType.stop,
        });
    }
    stop() {
        const self = this;
        self.cancelRampback();
        if(self.donePrompt) { self.donePrompt = false; xf.dispatch('watch:done-prompt', false); }
        if(self.isStarted() || self.isPaused()) {
            timer.postMessage('stop');
            // spinning on after the end never starts a new ride over the end screen
            self.autoStartCounter = -1;
            xf.dispatch(`ui:autoStartCounter`, -1);

            xf.dispatch('watch:event', {
                timestamp: Date.now(),
                type: EventType.stop,
            });


            if(self.isWorkoutStarted()) {
                xf.dispatch('workout:stopped');
            }

            // the last lap; a group ride's lap() is locked, so record it here
            if(self.groupMode) xf.dispatch('watch:lap'); else self.lap();

            // should be called after event and lap are created
            xf.dispatch('watch:stopped');

            if(exists(self.intervals)) {
                xf.dispatch('watch:intervalIndex', 0);
                xf.dispatch('watch:stepIndex',     0);
            }
            xf.dispatch('watch:elapsed', 0);
            xf.dispatch('watch:lapTime', 0);
        }
    }
    onTick() {
        const self   = this;
        let elapsed  = self.elapsed + 1;

        // a group ride's workout: the interval, step and time left come from
        // the group's clock (group/group.js); this only records
        if(self.groupMode && self.isWorkoutStarted()) {
            xf.dispatch('watch:elapsed', elapsed);
            self.dispatchTextEvent();
            return;
        }

        let lapTime  = self.lapTime;
        let stepTime = self.stepTime;

        if(self.isWorkoutStarted() && !equals(self.stepTime, 0)) {
            lapTime  -= 1;
            stepTime -= 1;
        } else {
            lapTime  += 1;
        }

        if(equals(lapTime, 4) && stepTime > 0) {
            xf.dispatch('watch:beep', 'interval');
        }
        xf.dispatch('watch:elapsed',  elapsed);
        xf.dispatch('watch:lapTime',  lapTime);
        xf.dispatch('watch:stepTime', stepTime);

        if(self.isWorkoutStarted() &&
           (stepTime <= 0) &&
            this.isIntervalType('duration')) {

            self.step();
        }

        // stepTime is written before stepIndex, so choose the message after step()
        self.dispatchTextEvent();
    }
    dispatchTextEvent() {
        let message = '';

        if(this.isWorkoutStarted() && exists(this.intervals) && !empty(this.intervals)) {
            const second = workoutSecond(
                this.intervals,
                this.intervalIndex,
                this.stepIndex,
                this.stepDuration,
                this.stepTime,
            );
            message = messageAt(this.textEvents, second);
        }

        if(equals(message, this.textEvent)) return;

        this.textEvent = message;
        xf.dispatch('watch:workoutTextEvent', message);
    }
    lap() {
        const self = this;

        // no skipping in a group ride: everyone rides the same interval
        if(self.groupMode && self.isWorkoutStarted()) return;

        if(self.isWorkoutStarted()) {
            let i             = self.intervalIndex;
            let s             = self.stepIndex;
            let intervals     = self.intervals;
            let moreIntervals = i < (intervals.length - 1);

            if(moreIntervals) {
                i += 1;
                s  = 0;

                self.nextInterval(intervals, i, s);
                self.nextStep(intervals, i, s);
            } else {
                xf.dispatch('workout:done');
            }
        } else {
            xf.dispatch('watch:lap');
            xf.dispatch('watch:lapTime', 0);
        }
    }
    // straight to interval i (the ramp test's cool-down, ramp-test.js)
    jump(i) {
        const self = this;
        if(self.groupMode && self.isWorkoutStarted()) return;
        if(!self.isWorkoutStarted()) return;
        if(!(i >= 0 && i < self.intervals.length) || i === self.intervalIndex) return;
        self.nextInterval(self.intervals, i, 0);
        self.nextStep(self.intervals, i, 0);
    }
    step() {
        const self        = this;
        let i             = self.intervalIndex;
        let s             = self.stepIndex;
        let intervals     = self.intervals;
        let steps         = intervals[i].steps;
        let moreIntervals = i < (intervals.length  - 1);
        let moreSteps     = s < (steps.length - 1);

        if(moreSteps) {
            s += 1;
            self.nextStep(intervals, i, s);
        } else if (moreIntervals) {
            i += 1;
            s  = 0;

            self.nextInterval(intervals, i, s);
            self.nextStep(intervals, i, s);
        } else {
            xf.dispatch('workout:done');
        }
    }
    nextInterval(intervals, intervalIndex, stepIndex) {
        if(exists(intervals[intervalIndex].duration)) {
            return this.nextDurationInterval(intervals, intervalIndex, stepIndex);
        }
        return undefined;
    }
    nextStep(intervals, intervalIndex, stepIndex) {
        if(this.isDurationStep(intervals, intervalIndex, stepIndex)) {
            this.intervalType = 'duration';
            return this.nextDurationStep(intervals, intervalIndex, stepIndex);
        }
        return undefined;
    }
    back() {
        const self = this;

        if(self.groupMode && self.isWorkoutStarted()) return;

        if(self.isWorkoutStarted()) {
            let i             = self.intervalIndex;
            let s             = self.stepIndex;
            let intervals     = self.intervals;
            let lessIntervals = (i - 1) >= 0;

            if(lessIntervals) {
                i -= 1;
                s  = 0;

                self.nextInterval(intervals, i, s);
                self.nextStep(intervals, i, s);
            }
        } else {
            xf.dispatch('watch:lap');
            xf.dispatch('watch:lapTime', 0);
        }
    }

    isDurationStep(intervals, intervalIndex, stepIndex) {
        return exists(intervals[intervalIndex].steps[stepIndex].duration);
    }
    nextDurationInterval(intervals, intervalIndex, stepIndex) {
        const intervalDuration = this.intervalsToDuration(intervals, intervalIndex);
        const stepDuration     = this.intervalsToStepDuration(intervals, intervalIndex, stepIndex);
        this.dispatchInterval(intervalDuration, intervalIndex);
    }
    nextDurationStep(intervals, intervalIndex, stepIndex) {
        const stepDuration = this.intervalsToStepDuration(intervals, intervalIndex, stepIndex);
        this.dispatchStep(stepDuration, stepIndex);
    }
    intervalsToDuration(intervals, intervalIndex) {
        return intervals[intervalIndex].duration;
    }
    intervalsToStepDuration(intervals, intervalIndex, stepIndex) {
        const steps = intervals[intervalIndex].steps;
        return steps[stepIndex].duration;
    }
    dispatchInterval(intervalDuration, intervalIndex) {
        xf.dispatch('watch:intervalDuration', intervalDuration);
        xf.dispatch('watch:lapTime',          intervalDuration);
        xf.dispatch('watch:intervalIndex',    intervalIndex);
        xf.dispatch('watch:lap');
    }
    dispatchStep(stepDuration, stepIndex) {
        xf.dispatch('watch:stepDuration', stepDuration);
        xf.dispatch('watch:stepTime',     stepDuration);
        xf.dispatch('watch:stepIndex',    stepIndex);
        xf.dispatch('watch:step');
    }
}

// These regs have access to the global db state and can mutate it
xf.reg('watch:lapDuration',    (time, db) => db.intervalDuration = time);
xf.reg('watch:stepDuration',   (time, db) => db.stepDuration     = time);
xf.reg('watch:lapTime',        (time, db) => db.lapTime          = time);
xf.reg('watch:stepTime',       (time, db) => db.stepTime         = time);
xf.reg('watch:workoutTextEvent', (message, db) => {
    db.workoutTextEvent = message;
});
xf.reg('watch:intervalIndex', (index, db) => db.intervalIndex    = index);

// More time on this interval (this fork, Nov 13, 2026, rider: "I want the
// ability to add time to an interval ... if I'm cooling down and just want
// a little more time, I should just be able to click a plus button to add
// 5 minutes at a time"). The time goes on the interval's last step, so a
// ramp (a cool-down) finishes and then holds its last power; the clocks,
// the workout graph and Time Left follow. The workout is copied first so
// the library's copy is never changed; the ride in progress keeps the
// longer one through a reload.
xf.reg('ui:interval-extend', (seconds, db) => {
    const add = Number(seconds) > 0 ? Number(seconds) : 300;
    if(db.workoutStatus !== 'started') return;
    // a group ride's workout is the same for everyone, start to finish
    if(db.groupMode) return;
    const i = db.intervalIndex;
    const res = extendInterval(db.workout, i, add);
    if(!res) return;
    db.workout = res.workout;
    xf.dispatch('watch:lapTime',     (db.lapTime ?? 0) + add);
    xf.dispatch('watch:lapDuration', (db.intervalDuration ?? 0) + add);
    if(db.stepIndex === res.last) {
        xf.dispatch('watch:stepTime',     (db.stepTime ?? 0) + add);
        xf.dispatch('watch:stepDuration', (db.stepDuration ?? 0) + add);
    }
    xf.dispatch('interval:extended', {interval: i, added: add});
});
xf.reg('watch:stepIndex',     (index, db) => {
    db.stepIndex         = index;
    const intervalIndex  = db.intervalIndex;
    const powerTarget    = db.workout.intervals[intervalIndex].steps[index].power;
    const slopeTarget    = db.workout.intervals[intervalIndex].steps[index].slope;
    const cadenceTarget  = db.workout.intervals[intervalIndex].steps[index].cadence;
    const distanceTarget = db.workout.intervals[intervalIndex].steps[index].distance;

    if(exists(slopeTarget)) {
        xf.dispatch('ui:slope-target-set', slopeTarget);
        if(!equals(db.mode, ControlMode.sim)) {
            xf.dispatch('ui:mode-set', ControlMode.sim);
        }
    }
    if(exists(distanceTarget)) {
        xf.dispatch('ui:distance-target-set', distanceTarget);
    }
    if(exists(cadenceTarget)) {
        xf.dispatch('ui:cadence-target-set', cadenceTarget);
    } else {
        xf.dispatch('ui:cadence-target-set', 0);
    }
    if(exists(powerTarget)) {
        // the workout's intensity applies to every step (db.js setIntensity)
        xf.dispatch('ui:power-target-set', Math.round(models.ftp.toAbsolute(powerTarget, db.ftp) * (db.intensity || 100) / 100));
        if(!exists(slopeTarget) && !equals(db.mode, ControlMode.erg)) {
            xf.dispatch('ui:mode-set', ControlMode.erg);
        }
    } else {
        xf.dispatch('ui:power-target-set', 0);
    }
});
xf.reg('workout:started', (x, db) => db.workoutStatus = 'started');
xf.reg('workout:stopped', (x, db) => db.workoutStatus = 'stopped');
xf.reg('workout:done',    (x, db) => db.workoutStatus = 'done');
xf.reg('watch:started',   (x, db) => {
    db.watchStatus = 'started';
    if(db.lapStartTime === false) {
        db.lapStartTime = Date.now(); // if first lap
    }
});
xf.reg('watch:paused',  (x, db) => db.watchStatus = 'paused');
xf.reg('watch:stopped', (x, db) => db.watchStatus = 'stopped');

xf.reg('watch:elapsed', models.session.elapsed);
xf.reg('watch:lap', models.session.lap);
xf.reg('watch:event', models.session.event);

const defaultDuration = 10;

function flattenMessages(intervals) {
    const textEvents = [];

    if(!exists(intervals) || empty(intervals)) return textEvents;

    let cursor = 0;

    for(let i = 0; i < intervals.length; i++) {
        const steps = intervals[i].steps ?? [];

        for(let s = 0; s < steps.length; s++) {
            const step = steps[s];

            if(!exists(step.duration)) continue;

            const messages = step.messages ?? [];

            for(let m = 0; m < messages.length; m++) {
                const textEvent = messages[m];

                if(!exists(textEvent.offset)) continue;
                // a plan cached before zwo.js dropped them may still carry one
                if(isLapInstruction(textEvent.message)) continue;

                const start    = cursor + textEvent.offset;
                const duration = exists(textEvent.duration) ? textEvent.duration : defaultDuration;

                textEvents.push({
                    start,
                    end: start + duration,
                    message: textEvent.message,
                });
            }

            cursor += step.duration;
        }
    }

    return textEvents;
}


function workoutSecond(intervals, intervalIndex, stepIndex, stepDuration, stepTime) {
    if(!exists(intervals) || empty(intervals)) return 0;

    let cursor = 0;

    for(let i = 0; i < intervalIndex; i++) {
        const steps = intervals[i]?.steps ?? [];

        for(let s = 0; s < steps.length; s++) {
            if(exists(steps[s].duration)) cursor += steps[s].duration;
        }
    }

    const steps = intervals[intervalIndex]?.steps ?? [];

    for(let s = 0; s < stepIndex; s++) {
        if(exists(steps[s]) && exists(steps[s].duration)) {
            cursor += steps[s].duration;
        }
    }

    if(exists(stepDuration)) {
        cursor += stepDuration - stepTime;
    }

    return cursor;
}

function messageAt(textEvents, second) {
    let message = '';

    if(!exists(textEvents) || empty(textEvents)) return message;

    for(let i = 0; i < textEvents.length; i++) {
        const textEvent = textEvents[i];

        if(second >= textEvent.start && second < textEvent.end) {
            message = textEvent.message;
        }
    }

    return message;
}

const watch = new Watch();

export { watch };
