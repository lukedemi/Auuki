//
// When pedalling ends a pause you set yourself (watch.js; the pause screen
// counts it down).
//
// A pause's first seconds are not evidence (rider, Nov 17, 2026: "it
// actually restarted the ride, even though I was clearly not doing
// anything"). Bluetooth power meters hold their last reading for a few
// seconds after the cranks stop, and a trainer's flywheel spins down. At
// 13:50:34 that day the pedals kept reporting ~95-118 W at 80 rpm for four
// seconds, and the ride resumed at :38 with his legs still. So pedalling
// counts only after the grace, and only above both floors; feet drifting on
// the pedals make neither 60 W nor 40 rpm. Then RESUME_AFTER_S of it in a
// row resumes the ride.
//

export const RESUME_GRACE_S = 6;
export const RESUME_MIN_W   = 60;
export const RESUME_MIN_RPM = 40;
export const RESUME_AFTER_S = 5;

export function pedallingThroughPause({power = 0, cadence = 0, pausedAt = 0, now = Date.now()} = {}) {
    if(now - (pausedAt ?? 0) < RESUME_GRACE_S * 1000) return false;
    return power > RESUME_MIN_W && (cadence ?? 0) > RESUME_MIN_RPM;
}
