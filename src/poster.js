//
// The ride image (rider, Nov 26, 2026, after six rounds of drafts and two
// real posts): navy and fluorescent orange on paper. The workout's name as a
// small tracked label; the chart nearly edge to edge, the main set's reps in
// soft orange, an FTP line labelled without its number ("FTP can be inferred
// just not too explicit"), power in navy with a W beside the chart, heart
// rate the one red line with a heart where it ends; four numbers Strava's own
// header does not show (NP, the main set's watts, average heart rate, TSS);
// infERGno.com at the foot. No date, no FTP figure, no headline.
//
// 1500 × 1000 (3:2). Strava's phone app shows it whole; a desktop feed box is
// ~486 px tall and as wide as the window, so at ~1.9 : 1 it crops ~105 px off
// the top and the bottom: the label and the numbers sit inside that, and the
// label sits below the "Virtual" badge Strava lays over the top-left corner.
// (Until later the same day it was a 4:5 poster with the main set as huge
// type, which the feed cut in half, and which did not scale to every workout.)
//
// posterSvg(m, {date}) takes the card model both this app (ride-card.js
// cardModel) and lukedemi/bikes (rides/site/src/card.js cardModel) build:
//   {title, ftp, end, step, pts: [[t, w, hr]], blocks: [{s0, s1, lo, hi}],
//    labels: [{s0, s1, target}] (the main set's reps), stats: [[value, key]]}
// It has no imports beyond its fonts, so the same file runs in the browser
// and in the bikes Worker. Keep the two copies the same.
//
import { POSTER_FONTS } from './poster-fonts.js';

export const POSTER_W = 1500, POSTER_H = 1000;

const NAVY = '#24337a', ORANGE = '#ff6c2f', PAPER = '#f4efe3', RED = '#ec1f45', DIM = '#5b6496';
const REP = '#ffa877';
const DISPLAY = "'InfergnoDisplay', 'Inter Display', Inter, sans-serif";
const TEXT = "'InfergnoText', Inter, sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
function smooth(values, n) {
    const out = [];
    let s = 0;
    for(let i = 0; i < values.length; i++) {
        s += values[i];
        if(i >= n) s -= values[i - n];
        out.push(s / Math.min(i + 1, n));
    }
    return out;
}

// "5×8" + "MIN": the main set, from its reps — how many, and how long the
// usual one is. A ride with no main set is its length: "60" + "MIN".
export function headlineOf(m) {
    const ftp = m.ftp || 0;
    // the candidates: the reps the card model found, or (when it found none:
    // 30/15s, 1-min VO2) every hard block
    let cands = (m.labels ?? []).map((r) => ({s0: r.s0, s1: r.s1, target: r.target, w: r.w}));
    if(!cands.length && ftp) cands = (m.blocks ?? []).filter((b) => b.lo === b.hi && b.lo >= 0.85 * ftp && b.s1 - b.s0 >= 15)
        .map((b) => ({s0: b.s0, s1: b.s1, target: b.lo}));
    // the main set is the rep length that carries the most time, at its
    // hardest (so a lone 3-min opener before 5 × 8 min is not a sixth rep).
    // Lengths within ~12% are one length: laps pressed by hand wander
    // (Oct 8, 2026's "14-minute" reps were 12:44, 12:46 and 12:35).
    const sorted = cands.slice().sort((a, b) => (a.s1 - a.s0) - (b.s1 - b.s0));
    const groups = [];
    for(const c of sorted) {
        const g = groups[groups.length - 1];
        if(g && (c.s1 - c.s0) <= 1.12 * (g[0].s1 - g[0].s0)) g.push(c); else groups.push([c]);
    }
    const timeOf = (g) => g.reduce((a, c) => a + c.s1 - c.s0, 0);
    let best = null;
    for(const g of groups) if(!best || timeOf(g) > timeOf(best)) best = g;
    let reps = [];
    if(best) {
        const top = Math.max(...best.map((c) => c.target));
        reps = best.filter((c) => c.target >= 0.95 * top).sort((a, b) => a.s0 - b.s0);
    }
    if(!reps.length) return {main: String(Math.max(1, Math.round((m.end || 0) / 60))), unit: 'MIN', reps};
    const durs = reps.map((r) => r.s1 - r.s0).sort((a, b) => a - b);
    const d = durs[Math.floor(durs.length / 2)];
    // the whole minute from 5 min up, the half minute from 2, seconds below
    const secs = d >= 300 ? Math.round(d / 60) * 60 : d >= 120 ? Math.round(d / 30) * 30 : Math.round(d / 5) * 5;
    const len = secs % 60 === 0 ? String(secs / 60) : secs >= 120 ? String(Math.round(secs / 30) / 2) : String(secs);
    const unit = secs % 60 === 0 || secs >= 120 ? 'MIN' : 'SEC';
    return {main: reps.length > 1 ? `${reps.length}×${len}` : len, unit, reps};
}

// A ramp arrives as a stair of short steps (the app writes one every 10 s):
// back-to-back short blocks a few watts apart, merged into one sloped block,
// so the warm-up is drawn as a slope instead of slivers.
export function mergeRamps(blocks, ftp) {
    const out = [];
    for(const b of blocks ?? []) {
        const last = out[out.length - 1];
        const short = (q) => q.s1 - q.s0 <= 60;
        if(last && last.ramp !== false && last.s1 === b.s0 && short(b) && (last.ramp || short(last))
            && Math.abs(b.lo - last.hi) <= Math.max(3, 0.05 * (ftp || 250))) {
            last.s1 = b.s1; last.hi = b.hi; last.ramp = true;
        } else out.push({...b, ramp: undefined});
    }
    return out.map(({ramp, ...b}) => b);
}

// the main set's average power: the reps' own averages where the card model
// has them (both apps label each rep with its watts), weighted by length;
// else the samples inside them
function mainSetWatts(m, reps) {
    if(reps.length && reps.every((r) => r.w > 0)) {
        const t = reps.reduce((a, r) => a + (r.s1 - r.s0), 0);
        if(t > 0) return Math.round(reps.reduce((a, r) => a + r.w * (r.s1 - r.s0), 0) / t);
    }
    const w = (m.pts ?? []).filter((p) => reps.some((r) => p[0] > r.s0 && p[0] <= r.s1)).map((p) => p[1] || 0);
    return w.length ? Math.round(mean(w)) : null;
}

// a heart, centred at (cx, cy), s px wide
const heart = (cx, cy, s) => `<path transform="translate(${(cx - s / 2).toFixed(1)},${(cy - s * 0.46).toFixed(1)}) scale(${s / 24})" d="M12 21.6C6 17.4 1.6 13.4 1.6 8.6 1.6 5.4 4 3 7 3c2 0 3.8 1.1 5 2.9C13.2 4.1 15 3 17 3c3 0 5.4 2.4 5.4 5.6 0 4.8-4.4 8.8-10.4 13z" fill="${RED}"/>`;

// The four numbers: what Strava's header (distance, time, average power)
// does not show. A ride with no main set gives its kJ instead; one with no
// heart rate, its time.
export function numbersOf(m, reps) {
    const stat = (key) => (m.stats ?? []).find(([, k]) => k.toLowerCase() === key)?.[0] ?? '—';
    const set = reps.length ? mainSetWatts(m, reps) : null;
    const hr = stat('avg bpm');
    return [
        [stat('np'), 'NP'],
        set != null ? [`${set} W`, 'MAIN SET'] : [stat('kj'), 'KJ'],
        hr !== '—' ? [hr, 'AVG HR'] : [stat('time'), 'TIME'],
        [stat('tss'), 'TSS'],
    ];
}

export function posterSvg(m, {fonts = POSTER_FONTS} = {}) {
    const W = POSTER_W, H = POSTER_H, X = 64, R = W - 64;
    const ftp = m.ftp || 0;
    const step = m.step || 5;
    const end = Math.max(1, m.end || 1);
    const pts = m.pts ?? [];
    const reps = headlineOf(m).reps;
    const blocks = mergeRamps(m.blocks, m.ftp);
    // what is coloured: the main set's reps; a ride without one, its work (70%+)
    const lit = (b) => reps.length
        ? reps.some((r) => (b.s0 + b.s1) / 2 > r.s0 && (b.s0 + b.s1) / 2 < r.s1)
        : ftp > 0 && (b.lo + b.hi) / 2 >= 0.68 * ftp;          // 70%, after rounding to whole watts

    // the chart
    const x0 = X, y0 = 250, cw = R - X - 78, ch = 470, base = y0 + ch;
    const x = (t) => x0 + cw * t / end;
    const ws = smooth(pts.map((p) => p[1] || 0), Math.max(1, Math.round(15 / step)));
    const hs = smooth(pts.map((p) => p[2] || 0), Math.max(1, Math.round(20 / step)));
    const top = Math.max(1.1 * (ftp || 250), 1.2 * Math.max(0, ...blocks.map((b) => Math.max(b.lo, b.hi))),
        1.05 * (ws.slice().sort((a, b) => a - b)[Math.floor(ws.length * 0.98)] ?? 0));
    const y = (w) => base - ch * Math.min(Math.max(w, 0), top) / top;
    // heart rate on its own scale, from the readings, so its rise and fall fill the height
    const ridden = (i) => (pts[i][1] || 0) > 30 && (pts[i][2] || 0) > 60;
    const hrRaw = pts.filter((p, i) => ridden(i)).map((p) => p[2]);
    const hrLo = hrRaw.length ? Math.floor((Math.min(...hrRaw) - 4) / 10) * 10 : 80;
    const hrHi = hrRaw.length ? Math.ceil((Math.max(...hrRaw) + 4) / 10) * 10 : 180;
    const yh = (v) => base - ch * (Math.min(Math.max(v, hrLo), hrHi) - hrLo) / (hrHi - hrLo);
    // both lines start at the first pedal stroke; heart rate breaks where it dropped out
    const first = pts.findIndex((p) => (p[1] || 0) > 30);
    const path = (vals, ok, yf) => {
        let pen = 'M';
        return vals.map((v, i) => {
            if(i < first || !ok(i)) { pen = 'M'; return ''; }
            const s = `${pen}${x(pts[i][0]).toFixed(1)},${yf(v).toFixed(1)}`;
            pen = 'L';
            return s;
        }).join('');
    };
    const pPath = first < 0 ? '' : path(ws, () => true, y);
    const hPath = first < 0 || !hrRaw.length ? '' : path(hs, ridden, yh);

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${TEXT}">`);
    if(fonts) out.push(`<style>${fonts}</style>`);
    out.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);

    // the workout's name, a small tracked label
    const title = String(m.title || 'Ride').toUpperCase();
    const shown = title.length > 44 ? `${title.slice(0, 43)}…` : title;
    out.push(`<text x="${X}" y="176" font-size="32" font-weight="700" letter-spacing="${shown.length > 28 ? 4 : 8}" fill="${NAVY}">${esc(shown)}</text>`);
    out.push(`<rect x="${X}" y="200" width="96" height="7" fill="${ORANGE}"/>`);

    // the plan: only what is lit
    out.push(`<g style="mix-blend-mode:multiply">`);
    for(const b of blocks) {
        if(!lit(b)) continue;
        out.push(`<path d="M${x(b.s0).toFixed(1)},${base}L${x(b.s0).toFixed(1)},${y(b.lo).toFixed(1)}L${x(b.s1).toFixed(1)},${y(b.hi).toFixed(1)}L${x(b.s1).toFixed(1)},${base}Z" fill="${REP}"/>`);
    }
    out.push(`</g>`);
    // FTP, the line everything reads against, without its number
    const gx = x0 + cw + 28;
    if(ftp > 0) {
        out.push(`<line x1="${x0}" x2="${x0 + cw}" y1="${y(ftp).toFixed(1)}" y2="${y(ftp).toFixed(1)}" stroke="${NAVY}" stroke-width="2" stroke-opacity=".55"/>`);
        out.push(`<text x="${gx}" y="${(y(ftp) + 6).toFixed(1)}" text-anchor="middle" font-size="17" font-weight="700" letter-spacing="1.5" fill="${NAVY}" fill-opacity=".7">FTP</text>`);
    }
    out.push(`<line x1="${x0}" x2="${x0 + cw}" y1="${base}" y2="${base}" stroke="${NAVY}" stroke-opacity=".25" stroke-width="2"/>`);
    if(pPath) out.push(`<path d="${pPath}" fill="none" stroke="${NAVY}" stroke-width="2.4" stroke-linejoin="round"/>`);
    if(hPath) out.push(`<path d="${hPath}" fill="none" stroke="${RED}" stroke-width="3.8" stroke-linejoin="round" stroke-linecap="round"/>`);

    // the heart where heart rate ends; the W at the power the ride finished on
    // (the last 2 minutes' median, not its drop to zero) — never on top of each other
    const lastHr = hs.map((v, i) => (ridden(i) ? v : null)).filter((v) => v != null).pop();
    const tail = pts.slice(-Math.max(2, Math.round(120 / step))).map((p) => p[1] || 0).filter((v) => v > 30).sort((a, b) => a - b);
    let wy = tail.length ? y(tail[Math.floor(tail.length / 2)]) : null;
    const hy = lastHr != null ? yh(lastHr) : null;
    if(wy != null && hy != null && Math.abs(wy - hy) < 36) wy = hy - 38;
    if(hy != null) out.push(heart(gx, hy, 28));
    if(wy != null) out.push(`<text x="${gx}" y="${(wy + 10).toFixed(1)}" text-anchor="middle" font-family="${DISPLAY}" font-size="30" font-weight="900" fill="${NAVY}">W</text>`);

    // four numbers, and infERGno.com
    numbersOf(m, reps).forEach(([v, k], i) => {
        const sx = X + i * 270;
        out.push(`<text x="${sx}" y="816" font-family="${DISPLAY}" font-size="58" font-weight="800" fill="${NAVY}">${esc(v)}</text>
            <text x="${sx}" y="852" font-size="19" font-weight="700" letter-spacing="2" fill="${ORANGE}">${k}</text>`);
    });
    out.push(`<text x="${R}" y="836" text-anchor="end" font-family="${DISPLAY}" font-size="46" font-weight="800" letter-spacing="-.5" fill="${NAVY}">inf<tspan fill="${ORANGE}" font-weight="900">E</tspan><tspan fill="${ORANGE}" font-weight="900">R</tspan><tspan fill="${RED}" font-weight="900">G</tspan>no<tspan fill="${DIM}">.com</tspan></text>`);
    out.push('</svg>');
    return out.join('\n');
}
