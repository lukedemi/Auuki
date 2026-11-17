//
// Group rides: where the workout is, from the clock alone.
//
// Every rider holds the same schedule (the workout, frozen when the ride was
// created, and its start time) and the same clock (server time, clock.js),
// so every rider works out the same interval on the same second without
// being told. Nothing here keeps state; the watch asks once a tick
// (group.js). doc/group-ride.md § Time.
//

export const LOBBY_S = 15 * 60;

// The workout as one line of steps: [{iv, st, start, dur}], start and dur in
// whole seconds from the workout's start. Throws on a workout that a clock
// can't drive (a step measured in distance, or none at all).
export function timeline(workout) {
    const intervals = workout?.intervals ?? [];
    const steps = [];
    const ivs = [];
    let cursor = 0;
    intervals.forEach((interval, iv) => {
        const start = cursor;
        (interval?.steps ?? []).forEach((step, st) => {
            const dur = Math.round(Number(step?.duration));
            if(!Number.isFinite(dur) || dur <= 0) {
                throw new Error(`step ${st + 1} of interval ${iv + 1} has no duration (distance steps can't be ridden as a group)`);
            }
            steps.push({iv, st, start: cursor, dur});
            cursor += dur;
        });
        if(cursor === start) throw new Error(`interval ${iv + 1} has no steps`);
        ivs.push({start, dur: cursor - start});
    });
    if(!steps.length) throw new Error('the workout has no steps');
    return {steps, intervals: ivs, durationS: cursor};
}

// The step running at second s of the workout (0 ≤ s < duration).
function stepAt(steps, s) {
    let lo = 0, hi = steps.length - 1;
    while(lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if(steps[mid].start <= s) lo = mid; else hi = mid - 1;
    }
    return steps[lo];
}

// schedule: {startAt (epoch ms), lobbyS, timeline}
//
// Seconds are whole and counted like the watch counts them: at the start of
// a 60 s step, stepLeft is 60; one second later 59; at 1 the next second
// is the next step's first.
export function positionAt(schedule, nowMs) {
    const {startAt, timeline: tl} = schedule;
    const lobbyS = schedule.lobbyS ?? LOBBY_S;
    const t = (nowMs - startAt) / 1000;
    if(t < -lobbyS) {
        return {phase: 'closed', opensIn: Math.ceil(-lobbyS - t)};
    }
    if(t < 0) {
        return {phase: 'warmup', startsIn: Math.ceil(-t)};
    }
    const s = Math.floor(t);
    if(s >= tl.durationS) {
        return {phase: 'cooldown', since: s - tl.durationS};
    }
    const step = stepAt(tl.steps, s);
    const interval = tl.intervals[step.iv];
    return {
        phase: 'workout',
        second: s,
        intervalIndex: step.iv,
        stepIndex: step.st,
        stepDuration: step.dur,
        stepLeft: step.start + step.dur - s,
        intervalDuration: interval.dur,
        intervalLeft: interval.start + interval.dur - s,
        workoutLeft: tl.durationS - s,
    };
}

// The key a position changes on: a new value means a new second (or phase).
export function positionKey(pos) {
    if(pos.phase === 'workout') return `w${pos.second}`;
    if(pos.phase === 'warmup') return `u${pos.startsIn}`;
    if(pos.phase === 'cooldown') return `c${pos.since}`;
    return `x${pos.opensIn}`;
}
