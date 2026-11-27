//
// The lap stopwatch (rider, Nov 27, 2026: "you press the letter L and it
// starts a little tiny timer, and that's all it does … so you know you've
// been doing something for that amount of time").
//
// L starts it at 0:00; each press after that starts a new lap from 0:00 and
// keeps the one just finished as "last". It counts on the ride's own clock
// (db:elapsed), so it holds while the ride is paused and never touches the
// workout: no interval is split or skipped, nothing is recorded. Clicking it
// puts it away; stopping the ride clears it.
//
// Pure state here; the pill is views/lap-stopwatch.js.
//

export const idle = () => ({start: null, n: 0, last: null});

export function press(state, elapsed) {
    const running = state.start !== null;
    return {
        start: elapsed,
        n:     state.n + 1,
        last:  running ? Math.max(0, elapsed - state.start) : null,
    };
}

export function seconds(state, elapsed) {
    if(state.start === null) return null;
    return Math.max(0, (elapsed ?? 0) - state.start);
}

// 0:07, 4:12, 1:02:03
export function clock(s) {
    s = Math.max(0, Math.floor(s ?? 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const pad = (x) => String(x).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}
