//
// The live chart, in the Graph panel on the home page.
//
// Power over the workout's targets (blocks coloured by zone), heart rate on
// its own scale, over a window tapped through 2 min · 10 min · 30 min · Ride,
// with the window's average power and heart rate in the header. Reads
// live-samples.js, so it draws while the timer runs and keeps the last ride
// on screen after it stops.
//
// A third of each fixed window is the future (rider, Nov 26, 2026: "Almost a
// third of it should be into the future, so you can see upcoming intervals as
// they kind of come into view… I have 30 seconds left until the next
// interval, and it's pretty hard to tell how far away I am"). Now is a line
// two-thirds across; to its right the workout's coming targets, from the
// step running and its time left (ahead()), fainter than the past, with the
// time to the next change and its watts at that edge. Ride fits the whole
// ride and has no future.
//

import { xf, exists } from '../functions.js';
import { models } from '../models/models.js';
import liveSamples from '../live-samples.js';
import { ahead, nextChange } from '../plan-ahead.js';

const WINDOWS = [
    { key: '2m',   label: '2 min',  s: 120,      smooth: 3 },
    { key: '10m',  label: '10 min', s: 600,      smooth: 5 },
    { key: '30m',  label: '30 min', s: 1800,     smooth: 10 },
    { key: 'ride', label: 'Ride',   s: Infinity, smooth: 15 },
];
const STORE = 'live-chart-window';
const FUTURE = 1 / 3;              // of a fixed window, ahead of now
const ZONE_VAR = {
    one: '--zone-gray', two: '--zone-blue', three: '--zone-teal', four: '--zone-green',
    five: '--zone-yellow', six: '--zone-orange', seven: '--zone-red',
};

const style = `
live-chart {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    padding: 0.4em 0.6em 0.3em; box-sizing: border-box; color: var(--foreground-color, #eee);
}
live-chart .lc--head { display: flex; align-items: center; gap: 0.6em; font-size: 0.85em; min-height: 1.8em; }
live-chart .lc--windows { display: flex; gap: 0.3em; }
live-chart .lc--win {
    font: inherit; color: inherit; background: transparent; border: 1px solid var(--border-color, #444);
    border-radius: 999px; padding: 0.1em 0.7em; opacity: 0.6; cursor: pointer;
}
live-chart .lc--win.active { opacity: 1; background: var(--chrome, #333); }
live-chart .lc--stats { margin-left: auto; font-variant-numeric: tabular-nums; opacity: 0.85; }
live-chart .lc--stats b { font-weight: 700; }
live-chart svg { flex: 1; width: 100%; min-height: 0; display: block; }
live-chart .lc--empty { fill: currentColor; opacity: 0.45; font-size: 14px; }
live-chart .lc--grid { stroke: currentColor; opacity: 0.12; }
live-chart .lc--glabel { fill: currentColor; opacity: 0.45; font-size: 11px; }
live-chart .lc--now { stroke: currentColor; stroke-width: 1.5; opacity: 0.55; }
live-chart .lc--edge { stroke: currentColor; stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.35; }
live-chart .lc--next { fill: currentColor; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
`;

// the same running mean everywhere: n samples back
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

// at most `cols` points: each the mean of its bucket
function bucket(rows, cols, pick) {
    if(rows.length <= cols) return rows.map((r) => [r.t, pick(r)]);
    const size = rows.length / cols;
    const out = [];
    for(let c = 0; c < cols; c++) {
        const a = Math.floor(c * size), b = Math.max(a + 1, Math.floor((c + 1) * size));
        let s = 0;
        for(let i = a; i < b; i++) s += pick(rows[i]);
        out.push([rows[Math.min(b - 1, rows.length - 1)].t, s / (b - a)]);
    }
    return out;
}

// The power axis, fixed for the ride (rider, Nov 26, 2026: "the top panel,
// axis changes throughout the workout. We should just pick an axis and stick
// with it ... on a 12-minute interval, on the 10-minute view, it jumps right
// in the last 2 minutes and then jumps back afterward"). It was fitted to
// what the window held, the coming targets included, so a harder interval
// scrolling in or out rescaled everything. Now: the workout's hardest target
// (at its Workout %) plus 15% headroom, at least 110% of FTP; 150% of FTP
// with no workout; never above 250%. Power above the top is drawn at the top.
export function powerTop({workout, ftp, intensity = 100}) {
    ftp = ftp > 0 ? ftp : 250;
    let hardest = 0;
    for(const iv of workout?.intervals ?? []) {
        for(const st of iv?.steps ?? []) {
            if(exists(st?.power)) hardest = Math.max(hardest, models.ftp.toAbsolute(st.power, ftp) * intensity / 100);
        }
    }
    const top = hardest > 0 ? Math.max(1.1 * ftp, 1.15 * hardest) : 1.5 * ftp;
    return Math.round(Math.min(2.5 * ftp, top));
}

// The heart-rate axis, fixed too: 80 to 190 bpm, widened (never narrowed)
// when a ride goes outside it.
export function hrRange(hs, was = [80, 190]) {
    if(!hs.length) return was;
    return [Math.min(was[0], Math.min(...hs) - 5), Math.max(was[1], Math.max(...hs) + 5)];
}

// m:ss
const mss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function windowStats(rows) {
    const n = rows.length;
    if(!n) return { w: null, hr: null, bal: null };
    const w = Math.round(rows.reduce((a, r) => a + (r.w || 0), 0) / n);
    const hrs = rows.filter((r) => r.hr > 0);
    const hr = hrs.length ? Math.round(hrs.reduce((a, r) => a + r.hr, 0) / hrs.length) : null;
    // balance weighted by power, as head units average it; pedalling only
    const bals = rows.filter((r) => r.bal !== null && r.bal !== undefined && r.w > 0);
    const wsum = bals.reduce((a, r) => a + r.w, 0);
    const bal = wsum > 0 ? Math.round(bals.reduce((a, r) => a + r.bal * r.w, 0) / wsum) : null;
    return { w, hr, bal };
}

class LiveChart extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = { signal: this.abortController.signal };

        if(!document.getElementById('live-chart-style')) {
            const el = document.createElement('style');
            el.id = 'live-chart-style';
            el.textContent = style;
            document.head.appendChild(el);
        }

        let saved = null;
        try { saved = localStorage.getItem(STORE); } catch(e) {}
        this.win = WINDOWS.find((w) => w.key === saved) ?? WINDOWS[1];
        this.ftp = models.ftp.default ?? 250;

        this.innerHTML = `
            <div class="lc--head">
                <div class="lc--windows">${WINDOWS.map((w) =>
                    `<button type="button" class="lc--win" data-win="${w.key}">${w.label}</button>`).join('')}</div>
                <div class="lc--stats"></div>
            </div>
            <svg preserveAspectRatio="none"></svg>`;
        this.$svg = this.querySelector('svg');
        this.$stats = this.querySelector('.lc--stats');

        this.addEventListener('pointerup', (e) => {
            const key = e.target?.dataset?.win;
            if(!key) return;
            this.win = WINDOWS.find((w) => w.key === key) ?? this.win;
            try { localStorage.setItem(STORE, key); } catch(err) {}
            this.render();
        }, signal);

        this.plan = {workout: null, iv: 0, st: 0, stepLeft: 0, target: 0, intensity: 100, status: 'stopped'};
        const keep = (k) => (v) => { this.plan[k] = v; };
        xf.sub('db:workout',       keep('workout'), signal);
        xf.sub('db:intervalIndex', keep('iv'), signal);
        xf.sub('db:stepIndex',     keep('st'), signal);
        xf.sub('db:stepTime',      keep('stepLeft'), signal);
        xf.sub('db:powerTarget',   keep('target'), signal);
        xf.sub('db:intensity',     keep('intensity'), signal);
        xf.sub('db:workoutStatus', (v) => { this.plan.status = v; this.render(); }, signal);
        xf.sub('live:sample', () => this.render(), signal);
        xf.sub('db:ftp', (ftp) => { this.ftp = ftp || this.ftp; this.render(); }, signal);
        window.addEventListener('resize', () => this.render(), signal);
        if(typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.render());
            this.observer.observe(this);
        }
        this.render();
    }

    disconnectedCallback() {
        this.abortController.abort();
        this.observer?.disconnect();
    }

    render() {
        if(!this.$svg) return;
        this.querySelectorAll('.lc--win').forEach((b) => b.classList.toggle('active', b.dataset.win === this.win.key));

        const rect = this.$svg.getBoundingClientRect();
        const W = Math.max(50, Math.round(rect.width)), H = Math.max(40, Math.round(rect.height));
        this.$svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

        const all = liveSamples.all();
        const last = all.length ? all[all.length - 1].t : 0;
        const fixed = Number.isFinite(this.win.s);
        // a fixed window: two-thirds behind now, a third ahead, from the first
        // second (the start of a ride is an empty left, not a moving now line)
        const from = fixed ? last - this.win.s * (1 - FUTURE) : 0;
        const rows = all.filter((r) => r.t > from);

        const st = windowStats(rows);
        this.$stats.innerHTML = st.w == null ? '' :
            `avg <b>${st.w}</b> W${st.hr ? ` · <b>${st.hr}</b> bpm` : ''}${st.bal !== null ? ` · L/R <b>${st.bal}/${100 - st.bal}</b>` : ''}`;

        if(rows.length < 2) {
            this.$svg.innerHTML = `<text class="lc--empty" x="${W / 2}" y="${H / 2 + 34}" text-anchor="middle">Draws while the timer runs</text>`;
            return;
        }

        // x: a fixed window fills from the left, then scrolls; Ride fits it all
        const x0 = from;
        const x1 = fixed ? from + this.win.s : Math.max(last, 60);
        const padL = 34;
        const x = (t) => padL + (W - padL) * (t - x0) / (x1 - x0);

        const ftp = this.ftp || 250;
        const p = this.plan ?? {};
        const plan = {workout: p.workout, iv: p.iv, st: p.st, stepLeft: p.stepLeft, target: p.target, ftp, intensity: p.intensity || 100};
        const future = (fixed && p.status === 'started') ? ahead({...plan, seconds: x1 - last}) : [];
        // the next change of target, even past the window's edge
        const next = (fixed && p.status === 'started') ? nextChange(ahead({...plan, seconds: 24 * 3600})) : null;
        const n = Math.max(1, this.win.smooth);
        const ps = smooth(rows.map((r) => r.w || 0), n);
        const smoothed = rows.map((r, i) => ({ t: r.t, w: ps[i], hr: r.hr, target: r.target }));
        const pmax = powerTop({workout: p.workout, ftp, intensity: p.intensity || 100});
        const y = (w) => H - (H - 4) * Math.min(w, pmax) / pmax;

        const out = [];
        // gridlines at the zone edges
        // (a label that would sit on the one below it is skipped; its line stays)
        let lastLabel = Infinity;
        for(const pct of [55, 75, 90, 105, 120, 150, 200]) {
            const w = ftp * pct / 100;
            if(w > pmax) continue;
            const yy = y(w).toFixed(1);
            out.push(`<line class="lc--grid" x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}"/>`);
            if(lastLabel - (+yy) >= 13) {
                out.push(`<text class="lc--glabel" x="${padL - 4}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${pct}%</text>`);
                lastLabel = +yy;
            }
        }

        // targets: runs of one target, as blocks
        let runStart = 0;
        for(let i = 1; i <= rows.length; i++) {
            if(i < rows.length && rows[i].target === rows[runStart].target) continue;
            const tw = rows[runStart].target;
            if(tw > 0) {
                const zone = models.ftp.powerToZone(tw, ftp)?.name ?? 'one';
                const xa = x(rows[runStart].t - 1), xb = x(rows[i - 1].t);
                out.push(`<rect x="${xa.toFixed(1)}" y="${y(tw).toFixed(1)}" width="${Math.max(0.5, xb - xa).toFixed(1)}" height="${(H - y(tw)).toFixed(1)}" style="fill: var(${ZONE_VAR[zone] ?? '--zone-gray'})" opacity="0.4"/>`);
            }
            runStart = i;
        }

        // the future: the coming targets, fainter, right of a now line, with
        // the time to the next change and its watts at that edge
        if(fixed && x1 > last) {
            const xn = x(last);
            for(const f of future) {
                const zone = models.ftp.powerToZone(f.w, ftp)?.name ?? 'one';
                const xa = x(last + f.from), xb = x(last + f.to);
                out.push(`<rect class="lc--ahead" x="${xa.toFixed(1)}" y="${y(f.w).toFixed(1)}" width="${Math.max(0.5, xb - xa).toFixed(1)}" height="${(H - y(f.w)).toFixed(1)}" style="fill: var(${ZONE_VAR[zone] ?? '--zone-gray'})" opacity="0.22"/>`);
                out.push(`<line x1="${xa.toFixed(1)}" x2="${xb.toFixed(1)}" y1="${y(f.w).toFixed(1)}" y2="${y(f.w).toFixed(1)}" style="stroke: var(${ZONE_VAR[zone] ?? '--zone-gray'})" stroke-width="2" stroke-dasharray="4 3" opacity="0.9"/>`);
            }
            if(next) {
                const label = `${mss(next.from)} → ${next.w ? `${next.w} W` : 'free'}`;
                if(last + next.from <= x1) {
                    const xe = x(last + next.from);
                    out.push(`<line class="lc--edge" x1="${xe.toFixed(1)}" x2="${xe.toFixed(1)}" y1="0" y2="${H}"/>`);
                    const right = xe + 5 + 90 <= W;
                    const ty = Math.max(14, Math.min(H - 6, (next.w ? y(next.w) : H) - 6));
                    out.push(`<text class="lc--next" x="${(right ? xe + 5 : xe - 5).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${label}</text>`);
                } else {
                    // beyond the window: pinned to its right edge
                    out.push(`<text class="lc--next" x="${W - 4}" y="16" text-anchor="end">${label} ›</text>`);
                }
            }
            out.push(`<line class="lc--now" x1="${xn.toFixed(1)}" x2="${xn.toFixed(1)}" y1="0" y2="${H}"/>`);
        }

        // heart rate, fitted to what the window holds
        const cols = Math.max(20, Math.round((W - padL) / 2));
        const hrRows = smoothed.filter((r) => r.hr > 0);
        if(hrRows.length > 1) {
            const hs = hrRows.map((r) => r.hr);
            // widened by anything this ride has reached, so it never jumps back
            // (a new ride starts the samples over)
            if(!this.hrAxis || all.length < (this.hrAxisLen ?? 0)) this.hrAxis = [80, 190];
            this.hrAxisLen = all.length;
            this.hrAxis = hrRange(hs, this.hrAxis);
            const [lo, hi] = this.hrAxis;
            const yh = (v) => H - (H - 4) * (v - lo) / (hi - lo);
            const pts = bucket(hrRows, cols, (r) => r.hr).map(([t, v]) => `${x(t).toFixed(1)},${yh(v).toFixed(1)}`);
            out.push(`<polyline points="${pts.join(' ')}" fill="none" style="stroke: var(--zone-red, #ff6b6b)" stroke-width="1.5" opacity="0.85"/>`);
        }

        // power
        const pts = bucket(smoothed, cols, (r) => r.w).map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`);
        out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`);

        this.$svg.innerHTML = out.join('');
    }
}

customElements.define('live-chart', LiveChart);

export { LiveChart, smooth, bucket, WINDOWS, FUTURE, ahead, nextChange };
