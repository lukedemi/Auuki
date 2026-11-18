//
// What a workout is, in a line (rider, Nov 18, 2026: "On the workout picker
// let's have the core of each workout be described in the card itself. take a
// lil inspiration from the trainer road style").
//
// Read from the steps, not the description, so it is there for every workout,
// planned ones from intervals.icu included:
//
//   core(w)     "2 sets of 8 × 1 min at 121% · 1 min easy"
//               "3 × 15 min at 90% · 4 min easy"
//               "4 × 8 min over-unders 94–105% · 4 min easy"
//               "1 h 40 steady at 70%"
//   details(w)  the same with the warm-up and cool-down around it and watts at
//               the rider's FTP, for when the workout has no description
//
// The main set is the work steps between the warm-up and the cool-down (work:
// at least 85% of the highest power the workout holds for a tenth of its time,
// and at least 75% of FTP). Work steps back
// to back are one rep (an over-under is one rep with a range). Identical reps
// in a row are a group; identical groups in a row are sets. Groups doing less
// than a quarter of the main group's work (openers) are left out.
//
import { exists } from './functions.js';

const pct = (p) => `${Math.round(p * 100)}%`;
export function dur(s) {
    s = Math.round(s);
    if(s < 90 && s % 60) return `${s} s`;
    const m = Math.round(s / 60);
    if(m < 90) return `${m} min`;
    return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`;
}

// steps as {d: seconds, p: fraction of FTP or null}
export function stepsOf(workout, toFraction = (p) => p) {
    return (workout?.intervals ?? []).flatMap((iv) => iv.steps ?? [])
        .map((st) => ({d: Number(st.duration) || 0, p: exists(st.power) ? toFraction(st.power) : null}))
        .filter((s) => s.d > 0);
}

export function analyse(steps) {
    const powered = steps.filter((s) => s.p !== null);
    if(!powered.length) return null;
    // the level the workout works at: the highest power held for at least a
    // tenth of the ride (short openers and sprints are not what it is about)
    const total = powered.reduce((a, s) => a + s.d, 0);
    let acc = 0, max = 0;
    for(const s of [...powered].sort((a, b) => b.p - a.p)) { acc += s.d; max = s.p; if(acc >= total * 0.1) break; }
    const workAt = Math.max(0.75, max * 0.85);
    const isWork = (s) => s.p !== null && s.p >= workAt;
    const first = steps.findIndex(isWork);
    if(first < 0) {
        // nothing hard: a steady ride, read from its body (the steps of at
        // least 85% of its top level; the warm-up and cool-down are under it)
        const total = steps.reduce((a, s) => a + s.d, 0);
        const body = powered.filter((s) => s.p >= max * 0.85 - 0.005);
        const t = body.reduce((a, s) => a + s.d, 0) || 1;
        const lo = Math.min(...body.map((s) => s.p)), hi = Math.max(...body.map((s) => s.p));
        return {steady: true, total, p: body.reduce((a, s) => a + s.p * s.d, 0) / t, lo, hi};
    }
    let last = steps.length - 1;
    while(!isWork(steps[last])) last--;
    const warmup = steps.slice(0, first).reduce((a, s) => a + s.d, 0);
    const cooldown = steps.slice(last + 1).reduce((a, s) => a + s.d, 0);
    // reps (runs of work) and the rests between them
    const reps = [];
    let i = first;
    while(i <= last) {
        if(isWork(steps[i])) {
            const run = [];
            while(i <= last && isWork(steps[i])) run.push(steps[i++]);
            const d = run.reduce((a, s) => a + s.d, 0);
            const lo = Math.min(...run.map((s) => s.p)), hi = Math.max(...run.map((s) => s.p));
            const ramp = run.length >= 4 && run.every((s, k) => k === 0 || s.p > run[k - 1].p);
            reps.push({d, lo, hi, ramp, avg: run.reduce((a, s) => a + s.p * s.d, 0) / d, rest: 0, restP: null});
        } else {
            const rest = [];
            while(i <= last && !isWork(steps[i])) rest.push(steps[i++]);
            const r = reps[reps.length - 1];
            r.rest = rest.reduce((a, s) => a + s.d, 0);
            r.restP = rest.filter((s) => s.p !== null).reduce((a, s) => a + s.p * s.d, 0) / (rest.reduce((a, s) => a + (s.p !== null ? s.d : 0), 0) || 1);
        }
    }
    // groups of identical reps; a group ends where the rest after a rep is longer than the rest inside it
    const same = (a, b) => Math.abs(a.d - b.d) <= 2 && Math.abs(a.lo - b.lo) < 0.015 && Math.abs(a.hi - b.hi) < 0.015;
    const groups = [];
    for(const r of reps) {
        const g = groups[groups.length - 1];
        const inner = g && g.reps.length > 1 ? g.reps[0].rest : null;
        if(g && same(g.reps[0], r) && !g.closed && (inner === null || Math.abs(g.reps[g.reps.length - 1].rest - inner) <= 5 || g.reps.length === 1)) {
            g.reps.push(r);
        } else {
            groups.push({reps: [r]});
        }
        const cur = groups[groups.length - 1];
        // a rest clearly longer than the group's own closes it
        if(cur.reps.length > 1 && r.rest > cur.reps[0].rest + 5) cur.closed = true;
    }
    // sets: identical groups one after another
    const sets = [];
    for(const g of groups) {
        const s = sets[sets.length - 1];
        if(s && s.group.reps.length === g.reps.length && same(s.group.reps[0], g.reps[0])) s.count++;
        else sets.push({group: g, count: 1, setRest: 0});
        sets[sets.length - 1].setRest = g.reps[g.reps.length - 1].rest;
    }
    const work = (s) => s.count * s.group.reps.reduce((a, r) => a + r.d, 0);
    const biggest = Math.max(...sets.map(work));
    const core = sets.filter((s) => work(s) >= biggest * 0.25);
    return {steady: false, warmup, cooldown, sets: core, all: sets};
}

function setText(s, watts) {
    const reps = s.group.reps, r = reps[0];
    const range = `${Math.round(r.lo * 100)}–${pct(r.hi)}`;
    const at = r.ramp ? `ramp ${range}` : r.hi - r.lo >= 0.03 ? `over-unders ${range}` : `at ${pct(r.avg)}${watts ? ` (${watts(r.avg)} W)` : ''}`;
    const n = reps.length;
    const one = n > 1 ? `${n} × ${dur(r.d)} ${at}` : `${dur(r.d)} ${at}`;
    return s.count > 1 ? `${s.count} sets of ${one}` : one;
}
function restOf(s) {
    const reps = s.group.reps;
    const inner = reps.length > 1 ? reps[0].rest : 0;
    return inner >= 10 ? `${dur(inner)} easy` : '';
}

export function core(workout, toFraction) {
    const a = analyse(stepsOf(workout, toFraction));
    if(!a) return '';
    if(a.steady) return a.hi - a.lo >= 0.03 ? `${dur(a.total)} at ${Math.round(a.lo * 100)}–${pct(a.hi)}` : `${dur(a.total)} steady at ${pct(a.p)}`;
    return a.sets.map((s) => [setText(s), restOf(s)].filter(Boolean).join(' · ')).join(', then ');
}

export function details(workout, toFraction, ftp = 0) {
    const a = analyse(stepsOf(workout, toFraction));
    if(!a) return '';
    const watts = ftp > 0 ? (p) => Math.round(p * ftp) : null;
    if(a.steady) return a.hi - a.lo >= 0.03
        ? `${dur(a.total)} at ${Math.round(a.lo * 100)}–${pct(a.hi)} of FTP${watts ? ` (${watts(a.lo)}–${watts(a.hi)} W)` : ''}.`
        : `${dur(a.total)} steady at ${pct(a.p)} of FTP${watts ? ` (${watts(a.p)} W)` : ''}.`;
    const main = a.sets.map((s) => {
        const rest = restOf(s);
        return `${setText(s, watts)}${rest ? ` with ${rest} between` : ''}${s.count > 1 && s.setRest > 30 ? `, ${dur(s.setRest)} between sets` : ''}`;
    }).join(', then ');
    return [a.warmup >= 60 ? `${dur(a.warmup)} warm-up` : '', main, a.cooldown >= 60 ? `${dur(a.cooldown)} cool-down` : '']
        .filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';
}
