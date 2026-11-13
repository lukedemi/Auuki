//
// The ride, drawn for Strava: the Activities list's image button (rider,
// Nov 13, 2026: "I can't seem to download the image. It just has a little X
// when I point at it" — upstream left the button as a greyed placeholder).
//
// The same picture bikes.d3-mi.com draws from intervals.icu (lukedemi/bikes
// rides/site/src/card.js), drawn here from the ride itself: the workout's
// targets as zone-coloured blocks, his power and heart rate over them, the
// main set's reps labelled, and the headline numbers. 1600 x 1000 PNG.
//
// Where the ride comes from:
//   - a ride saved from this version on keeps its one-second samples
//     (power, heart rate and the target actually set, intensity and
//     extensions included) on the activity record, `chart`;
//   - an older ride is read back from its FIT: power and heart rate from the
//     records, FTP from the session, and the targets from the workout still
//     loaded, if it has the same name, one interval to each lap (Auuki laps
//     every interval itself).
//

import { fit } from './fit/fit.js';
import { normalizedPower } from './views/time-left.js';

const W = 1600, H = 1000;
export const BRAND = 'Auuki', BRAND_SUB = '(lukedemi fork)';
const L = 70, R = 40, T = 215, B = 950;
const PW = W - L - R, PH = B - T;

// Coggan's boundaries as % of FTP, the colours TrainerRoad's eye expects
const ZONES = [[56, '#7a7f8a'], [76, '#2f80ed'], [91, '#27ae60'], [106, '#f2c94c'], [121, '#f2994a'], [Infinity, '#eb5757']];
export const zoneColour = (pct) => ZONES.find(([lim]) => pct < lim)[1];

const escXml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// "📊 Capped sub-threshold — 5x8min ≤ 3.0 mmol" -> "Capped sub-threshold";
// "📊 🔒 QUALITY — Threshold 3x14 @ 97% (repeat…)" -> "Threshold 3x14 @ 97%"
export function cleanTitle(name) {
    let s = String(name || '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').trim();
    s = s.replace(/^[A-Z0-9 &/]{3,}\s+[—–-]\s+/, '');
    s = s.split(/\s+\(|\s+\+\s+|\s+[—–]\s+/)[0];
    return s.replace(/\s+/g, ' ').trim();
}

const hmm = (s) => { const m = Math.round((s || 0) / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

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

// ---------------------------------------------------------------- the ride

// A saved activity's `chart` (models.js Activity.chart): one value a second
// in parallel arrays t, w, hr, target, and the ride's FTP.
// `target` is what the blocks are drawn from: the plan as written when the
// ride kept one (what he was supposed to do), else the target that was set.
// `set` is the target that was set, for the dashed line where it differs.
function rowsOfChart(chart) {
    const plan = Array.isArray(chart.plan) && chart.plan.some((v) => v > 0) ? chart.plan : null;
    const set = chart.target ?? [];
    return (chart.t ?? []).map((t, i) => ({t, w: chart.w[i] ?? 0, hr: chart.hr[i] ?? 0,
        target: (plan ? plan[i] : set[i]) ?? 0, set: set[i] ?? 0}));
}

// the stretches where the target set (Workout %, a nudge) was not the plan's
function offPlan(rows) {
    const out = [];
    for(const r of rows) {
        const off = r.target > 0 && r.set > 0 && Math.abs(r.set - r.target) > Math.max(3, 0.02 * r.target);
        const last = out[out.length - 1];
        if(off && last && last.s1 === r.t - 1 && last.w === r.set) last.s1 = r.t;
        else if(off) out.push({s0: r.t - 1, s1: r.t, w: r.set});
    }
    return out.filter((r) => r.s1 - r.s0 >= 10);
}

// The workout's target for each second of a lap: interval k's steps, in
// order, the last one held if the lap ran long (an extension).
function lapTargets(interval, seconds, ftp, toAbsolute) {
    const out = [];
    const steps = interval?.steps ?? [];
    let s = 0, left = steps[0]?.duration ?? Infinity;
    for(let i = 0; i < seconds; i++) {
        while(left <= 0 && s < steps.length - 1) { s++; left = steps[s].duration ?? Infinity; }
        const p = steps[s]?.power;
        out.push(p == null ? 0 : toAbsolute(p, ftp));
        left--;
    }
    return out;
}

// An activity saved before `chart` existed, read back from its FIT.
export function chartFromFit(view, {name = '', workout = null, toAbsolute = null} = {}) {
    const msgs = fit.FITjs.decode(view).filter((m) => m.type === 'data');
    const records = msgs.filter((m) => m.name === 'record').map((m) => m.fields);
    const laps = msgs.filter((m) => m.name === 'lap').map((m) => m.fields);
    const session = msgs.find((m) => m.name === 'session')?.fields ?? {};
    const ftp = session.threshold_power || 0;

    const target = new Array(records.length).fill(0);
    const intervals = workout?.intervals ?? [];
    const sameWorkout = workout && intervals.length && cleanTitle(workout.meta?.name) === cleanTitle(name);
    if(sameWorkout && toAbsolute && ftp) {
        let i = 0;
        laps.forEach((lap, k) => {
            const start = i;
            while(i < records.length && records[i].timestamp <= lap.timestamp) i++;
            if(k >= intervals.length) return;
            const t = lapTargets(intervals[k], i - start, ftp, toAbsolute);
            for(let j = start; j < i; j++) target[j] = t[j - start];
        });
    }
    return {
        v: 1, ftp,
        t:      records.map((_, i) => i + 1),
        w:      records.map((r) => r.power ?? 0),
        hr:     records.map((r) => r.heart_rate ?? 0),
        target,
        plan: target.slice(),
    };
}

// ---------------------------------------------------------------- the model

// Runs of one target; a target set to 0 (a free ride) breaks a run.
function runs(rows) {
    const out = [];
    for(const r of rows) {
        const last = out[out.length - 1];
        if(last && last.target === r.target && last.s1 === r.t - 1) { last.s1 = r.t; last.rows.push(r); }
        else out.push({target: r.target, s0: r.t - 1, s1: r.t, rows: [r]});
    }
    return out;
}

// The session's reps: every run at 85% of FTP or more for 2 min or more
// (80% and 1 min when none qualifies), back-to-back runs joined, so a target
// nudged mid-rep is still one rep.
function reps(rs, ftp) {
    const pick = (pct, dur) => {
        const out = [];
        for(const r of rs) {
            if(r.target < pct * ftp) continue;
            const last = out[out.length - 1];
            if(last && last.s1 === r.s0) { last.s1 = r.s1; last.rows.push(...r.rows); last.target = Math.max(last.target, r.target); }
            else out.push({s0: r.s0, s1: r.s1, target: r.target, rows: [...r.rows]});
        }
        return out.filter((r) => r.s1 - r.s0 >= dur);
    };
    const chosen = pick(0.85, 120);
    return chosen.length ? chosen : pick(0.8, 60);
}

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

export function cardModel(chart, {name = ''} = {}) {
    const rows = rowsOfChart(chart);
    const ftp = chart.ftp || 0;
    const end = Math.max(1, rows.length ? rows[rows.length - 1].t : 1);
    const rs = runs(rows);

    const blocks = rs.filter((r) => r.target > 0).map((r) => ({s0: r.s0, s1: r.s1, lo: r.target, hi: r.target}));
    const set = offPlan(rows);
    const labels = ftp ? reps(rs.filter((r) => r.target > 0), ftp).map((r, n) => ({
        s0: r.s0, s1: r.s1, target: r.target, n: n + 1,
        w:  Math.round(mean(r.rows.map((x) => x.w))),
        hr: Math.round(mean(r.rows.filter((x) => x.hr > 0).map((x) => x.hr))),
    })) : [];

    // 5 s points for the lines
    const step = 5;
    const pts = [];
    for(let i = 0; i < rows.length; i += step) {
        const part = rows.slice(i, i + step);
        const hrs = part.filter((x) => x.hr > 0).map((x) => x.hr);
        pts.push([part[part.length - 1].t, mean(part.map((x) => x.w)), hrs.length ? mean(hrs) : 0]);
    }

    const watts = rows.map((r) => r.w);
    const np = Math.round(normalizedPower(watts));
    const iff = ftp ? np / ftp : null;
    const tss = ftp ? Math.round(rows.length * np * iff / (ftp * 3600) * 100) : null;
    const kj = Math.round(watts.reduce((a, b) => a + b, 0) / 1000);
    const hrs = rows.filter((r) => r.hr > 0).map((r) => r.hr);
    const stats = [
        [hmm(rows.length), 'time'],
        [np ? `${np} W` : '—', 'NP'],
        [iff != null ? iff.toFixed(2) : '—', 'IF'],
        [tss != null ? String(tss) : '—', 'TSS'],
        [kj.toLocaleString('en-US'), 'kJ'],
        [hrs.length ? String(Math.round(mean(hrs))) : '—', 'avg bpm'],
    ];

    return {v: 1, title: cleanTitle(name) || 'Ride', ftp: ftp || 300, end, step, pts, blocks, set, free: [], labels, stats};
}

// ---------------------------------------------------------------- the picture

export function cardSvg(m) {
    const ftp = m.ftp || 300;
    // 30 s of power, 20 s of heart rate
    const ps = smooth(m.pts.map((p) => p[1]), Math.max(1, Math.round(30 / m.step)));
    const hs = smooth(m.pts.map((p) => p[2]), Math.max(1, Math.round(20 / m.step)));
    // room above the hardest 30 s and the highest target, never under FTP, never over twice it
    const top = Math.max(0, ...ps, ...m.blocks.map((b) => Math.max(b.lo, b.hi)));
    const pmax = Math.min(2 * ftp, Math.max(ftp, 1.15 * top));
    const x = (t) => L + PW * t / m.end;
    const y = (w) => B - PH * Math.min(w, pmax) / pmax;
    const yh = (h) => B - PH * (h - 60) / (215 - 60);
    const f = (v) => v.toFixed(1);
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif">`);
    out.push(`<rect width="${W}" height="${H}" fill="#14161b"/>`);

    // the app, where the ride's title was (rider, Nov 13, 2026: "Instead of the title have it say Auuki (lukedemi fork)")
    out.push(`<text x="${L}" y="92" fill="#fff" font-size="46" font-weight="700">${escXml(BRAND)}<tspan fill="#7d8390" font-weight="500" font-size="32"> ${escXml(BRAND_SUB)}</tspan></text>`);
    m.stats.forEach(([v, lab], k) => {
        const sx = L + k * 245;
        out.push(`<text x="${sx}" y="162" fill="#fff" font-size="38" font-weight="700">${escXml(v)}</text>`);
        out.push(`<text x="${sx}" y="188" fill="#7d8390" font-size="20" letter-spacing="1">${escXml(lab.toUpperCase())}</text>`);
    });

    for(const pct of [55, 75, 90, 105, 120, 150]) {
        if(ftp * pct / 100 > pmax) continue;
        const yy = y(ftp * pct / 100);
        out.push(`<line x1="${L}" x2="${W - R}" y1="${f(yy)}" y2="${f(yy)}" stroke="#2a2e37" stroke-width="1"/>`);
        out.push(`<text x="${L - 10}" y="${f(yy + 6)}" fill="#565c68" font-size="17" text-anchor="end">${pct}%</text>`);
    }

    for(const b of m.blocks) {
        const c = zoneColour(100 * Math.max(b.lo, b.hi) / ftp);
        out.push(`<rect x="${f(x(b.s0))}" y="${f(y(b.lo))}" width="${f(Math.max(0.5, x(b.s1) - x(b.s0)))}" height="${f(B - y(b.lo))}" fill="${c}" opacity="0.55"/>`);
    }

    // where the target set was not the plan's (Workout %, a nudge): dashed, over the block
    for(const r of m.set ?? []) {
        out.push(`<line x1="${f(x(r.s0))}" x2="${f(x(r.s1))}" y1="${f(y(r.w))}" y2="${f(y(r.w))}" stroke="#ffffff" stroke-width="2" stroke-dasharray="8 6" opacity="0.7"/>`);
    }

    if(m.pts.length > 1) {
        out.push(`<polyline points="${m.pts.map((p, i) => `${f(x(p[0]))},${f(y(ps[i]))}`).join(' ')}" fill="none" stroke="#f4f6fa" stroke-width="2.2" stroke-linejoin="round"/>`);
    }
    const hp = m.pts.map((p, i) => (hs[i] > 60 ? `${f(x(p[0]))},${f(yh(hs[i]))}` : null)).filter(Boolean);
    if(hp.length > 1) out.push(`<polyline points="${hp.join(' ')}" fill="none" stroke="#ff6b6b" stroke-width="2" opacity="0.85"/>`);

    const many = m.labels.length > 6;
    for(const r of m.labels) {
        const cx = (x(r.s0) + x(r.s1)) / 2;
        const top = Math.max(T - 10, y(r.target) - (many ? 70 : 100));
        if(many) {
            out.push(`<text x="${f(cx)}" y="${f(top + 40)}" fill="#fff" font-size="22" font-weight="700" text-anchor="middle">${r.w}</text>`);
        } else {
            out.push(`<rect x="${f(cx - 88)}" y="${f(top)}" width="176" height="72" rx="10" fill="#1f232b" stroke="#3a3f4a"/>`);
            out.push(`<text x="${f(cx)}" y="${f(top + 32)}" fill="#fff" font-size="27" font-weight="700" text-anchor="middle">${r.w} W</text>`);
            out.push(`<text x="${f(cx)}" y="${f(top + 59)}" fill="#9aa0ab" font-size="19" text-anchor="middle">rep ${r.n}${r.hr ? ` · ${r.hr} bpm` : ''}</text>`);
        }
    }

    out.push(`<line x1="${L}" x2="${W - R}" y1="${B}" y2="${B}" stroke="#3a3f4a"/>`);
    const every = m.end > 4 * 3600 ? 3600 : m.end > 1.5 * 3600 ? 1800 : m.end > 1200 ? 900 : 300;
    for(let s = 0; s <= m.end; s += every) {
        out.push(`<text x="${f(x(s))}" y="${B + 28}" fill="#565c68" font-size="17" text-anchor="middle">${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}</text>`);
    }
    // the legend, inside the plot's bottom-left corner on a dark plate
    const items = [];
    if(m.blocks.length) items.push([`<rect x="0" y="-13" width="24" height="14" fill="#f2c94c" opacity="0.55"/>`, 'plan', 100]);
    if(m.set?.length) items.push([`<line x1="0" x2="26" y1="-6" y2="-6" stroke="#fff" stroke-width="2" stroke-dasharray="6 4" opacity="0.8"/>`, 'target set', 140]);
    items.push([`<line x1="0" x2="26" y1="-6" y2="-6" stroke="#f4f6fa" stroke-width="3"/>`, 'power', 112]);
    items.push([`<line x1="0" x2="26" y1="-6" y2="-6" stroke="#ff6b6b" stroke-width="3"/>`, 'heart rate', 128]);
    const plateW = items.reduce((a, it) => a + it[2], 0) + 16;
    out.push(`<g transform="translate(${L + 12},${B - 14})"><rect x="0" y="-26" width="${plateW}" height="34" rx="6" fill="#14161b" opacity="0.82"/>`);
    let lx = 12;
    for(const [mark, label, w] of items) {
        out.push(`<g transform="translate(${lx},0)">${mark}<text x="34" y="0" fill="#c4c8d0" font-size="18">${label}</text></g>`);
        lx += w;
    }
    out.push('</g>');
    out.push('</svg>');
    return out.join('');
}

// ---------------------------------------------------------------- the file

// SVG -> PNG through a canvas
export async function svgToPng(svg) {
    const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
    try {
        const im = new Image();
        await new Promise((ok, no) => { im.onload = ok; im.onerror = () => no(new Error('the image would not draw')); im.src = url; });
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d').drawImage(im, 0, 0);
        return await new Promise((ok) => c.toBlob(ok, 'image/png'));
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function fileName(timestamp) {
    const d = new Date(timestamp || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `ride-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.png`;
}

// A saved activity's chart, from the record or, for an older ride, its FIT.
export async function recordChart(record, {workout = null, toAbsolute = null} = {}) {
    if(record?.chart?.t?.length) return record.chart;
    if(!record?.blob) return null;
    const buf = await record.blob.arrayBuffer();
    return chartFromFit(new DataView(buf), {name: record.summary?.name, workout, toAbsolute});
}

export function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
