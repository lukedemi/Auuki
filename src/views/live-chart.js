//
// The live chart, in the Graph panel on the home page.
//
// Power over the workout's targets (blocks coloured by zone), heart rate on
// its own scale, over a window tapped through 2 min · 10 min · 30 min · Ride,
// with the window's average power and heart rate in the header. Reads
// live-samples.js, so it draws while the timer runs and keeps the last ride
// on screen after it stops.
//

import { xf, exists } from '../functions.js';
import { models } from '../models/models.js';
import liveSamples from '../live-samples.js';

const WINDOWS = [
    { key: '2m',   label: '2 min',  s: 120,      smooth: 3 },
    { key: '10m',  label: '10 min', s: 600,      smooth: 5 },
    { key: '30m',  label: '30 min', s: 1800,     smooth: 10 },
    { key: 'ride', label: 'Ride',   s: Infinity, smooth: 15 },
];
const STORE = 'live-chart-window';
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
        const from = Number.isFinite(this.win.s) ? Math.max(0, last - this.win.s) : 0;
        const rows = all.filter((r) => r.t > from);

        const st = windowStats(rows);
        this.$stats.innerHTML = st.w == null ? '' :
            `avg <b>${st.w}</b> W${st.hr ? ` · <b>${st.hr}</b> bpm` : ''}${st.bal !== null ? ` · L/R <b>${st.bal}/${100 - st.bal}</b>` : ''}`;

        if(rows.length < 2) {
            this.$svg.innerHTML = `<text class="lc--empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">Draws while the timer runs</text>`;
            return;
        }

        // x: a fixed window fills from the left, then scrolls; Ride fits it all
        const x0 = from;
        const x1 = Number.isFinite(this.win.s) ? Math.max(from + this.win.s, last) : Math.max(last, 60);
        const padL = 34;
        const x = (t) => padL + (W - padL) * (t - x0) / (x1 - x0);

        const ftp = this.ftp || 250;
        const n = Math.max(1, this.win.smooth);
        const ps = smooth(rows.map((r) => r.w || 0), n);
        const smoothed = rows.map((r, i) => ({ t: r.t, w: ps[i], hr: r.hr, target: r.target }));
        const topW = Math.max(ftp, 1.15 * Math.max(...ps, ...rows.map((r) => r.target || 0)));
        const pmax = Math.min(2.5 * ftp, topW);
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

        // heart rate, fitted to what the window holds
        const cols = Math.max(20, Math.round((W - padL) / 2));
        const hrRows = smoothed.filter((r) => r.hr > 0);
        if(hrRows.length > 1) {
            const hs = hrRows.map((r) => r.hr);
            let lo = Math.min(...hs) - 5, hi = Math.max(...hs) + 5;
            if(hi - lo < 40) { const mid = (hi + lo) / 2; lo = mid - 20; hi = mid + 20; }
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

export { LiveChart, smooth, bucket, WINDOWS };
