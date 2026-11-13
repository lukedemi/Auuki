//
// More time on an interval: the time goes on its last step (a ramp finishes,
// then holds its last power), the interval and the workout grow with it.
// A copy, so the library's workout is never changed. Used by watch.js
// (ui:interval-extend).
//

export function extendInterval(workout, intervalIndex, seconds) {
    const w = structuredClone(workout);
    const interval = w?.intervals?.[intervalIndex];
    if(!interval || !Number.isFinite(interval.duration) || !interval.steps?.length) return null;
    const last = interval.steps.length - 1;
    interval.steps[last].duration += seconds;
    interval.duration += seconds;
    if(w.meta) w.meta.duration = (w.meta.duration ?? 0) + seconds;
    return {workout: w, last};
}
