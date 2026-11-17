//
// The Workouts page on desktop: the workout you picked, large, beside the
// lists (index.html .wk--pane; the layout is the desktop block at the end of
// flux.css). A click on a workout in the Library or Planned shows it here
// (ui:workout:preview) without loading it; Load makes it the workout, and
// Load and ride also goes to the ride screen. Until something is picked it
// shows the workout that's loaded. Hidden on a phone, where the lists
// expand in place as before.
//

import { xf, exists, debounce } from '../functions.js';
import { models } from '../models/models.js';
import { intervalsToGraph, renderInfo } from './workout-graph.js';

const ZONES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const ZONE_VAR = {
    one: '--zone-gray', two: '--zone-blue', three: '--zone-teal', four: '--zone-green',
    five: '--zone-yellow', six: '--zone-orange', seven: '--zone-red',
};
// the app's zones (models.js FTP: 54, 75, 87, 94, 105, 120% of FTP)
const ZONE_NAME = {
    one: 'Recovery', two: 'Endurance', three: 'Tempo', four: 'Sweet Spot',
    five: 'Threshold', six: 'VO2 Max', seven: 'Anaerobic',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function clock(s) {
    s = Math.round(s);
    if(s > 0 && s < 60) return `${s} s`;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

// What riding it at this FTP adds up to: time, work, NP (from the steps, a
// close estimate: the 30 s rolling average barely matters on blocks this
// long), IF, TSS, time in each zone, how many intervals go over FTP.
export function workoutStats(workout, ftp) {
    const steps = (workout?.intervals ?? []).flatMap((iv) => iv.steps ?? []);
    let seconds = 0, joules = 0, p4 = 0, powered = 0;
    const zones = Object.fromEntries(ZONES.map((z) => [z, 0]));
    for(const st of steps) {
        const d = Number(st.duration);
        if(!(d > 0)) continue;
        seconds += d;
        if(!exists(st.power)) continue;
        const w = models.ftp.toAbsolute(st.power, ftp);
        if(!(w > 0)) continue;
        powered += d;
        joules += w * d;
        p4 += (w ** 4) * d;
        const zone = models.ftp.powerToZone(w, ftp)?.name ?? 'one';
        zones[zone] = (zones[zone] ?? 0) + d;
    }
    const np = powered ? (p4 / powered) ** 0.25 : 0;
    const IF = ftp > 0 && np ? np / ftp : 0;
    const efforts = (workout?.intervals ?? []).filter((iv) =>
        (iv.steps ?? []).some((st) => exists(st.power) && models.ftp.toAbsolute(st.power, ftp) >= ftp * 1.05)).length;
    return {
        seconds,
        kj: Math.round(joules / 1000),
        np: Math.round(np),
        IF: Math.round(IF * 100) / 100,
        tss: Math.round((seconds / 3600) * IF * IF * 100),
        zones,
        powered,
        efforts,
    };
}

const style = `
workout-detail { display: none; }
workout-detail .wd--head { display: flex; align-items: flex-start; gap: 1em; }
workout-detail .wd--title { flex: 1; min-width: 0; text-align: left; }
workout-detail .wd--title h2 { margin: 0; font-size: 1.9em; line-height: 1.2; font-weight: 700; overflow-wrap: anywhere; }
workout-detail .wd--sub { margin-top: .35em; opacity: .7; font-size: 1.05em; }
workout-detail .wd--sub b { opacity: 1; color: var(--foreground-color); }
workout-detail .wd--actions { display: flex; gap: .6em; flex: none; }
workout-detail button { font: inherit; font-size: 1em; padding: .6em 1.1em; border-radius: 8px; cursor: pointer; white-space: nowrap;
    border: 1px solid var(--border-color, #555); background: transparent; color: var(--foreground-color, #eee); }
workout-detail button.wd--primary { background: var(--zone-green, #57C057); color: #111; border-color: transparent; font-weight: 700; }
workout-detail .wd--loaded { align-self: center; padding: .4em .8em; border-radius: 8px; background: rgba(87,192,87,.15);
    color: var(--zone-green, #57C057); font-weight: 600; white-space: nowrap; }
workout-detail .wd--stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: .6em; margin: 1.3em 0 1em; }
workout-detail .wd--stat { text-align: left; padding: .7em .9em; border-radius: 10px; background: var(--background-color-2, rgba(255,255,255,.04)); }
workout-detail .wd--stat .v { font-size: 1.6em; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; }
workout-detail .wd--stat .k { font-size: .8em; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin-top: .2em; }
workout-detail .wd--graph { position: relative; height: 15em; margin: .4em 0 .2em; }
workout-detail .wd--graph .workout-list--graph-cont { position: absolute; inset: 0; display: flex; align-items: flex-end; }
workout-detail .wd--axis { display: flex; justify-content: space-between; font-size: .8em; opacity: .5; font-variant-numeric: tabular-nums; }
workout-detail .wd--zones { margin-top: 1.4em; text-align: left; }
workout-detail .wd--zbar { display: flex; height: .7em; border-radius: 4px; overflow: hidden; background: rgba(255,255,255,.06); }
workout-detail .wd--zbar span { display: block; height: 100%; }
workout-detail .wd--zlegend { display: flex; flex-wrap: wrap; gap: .3em 1.2em; margin-top: .6em; font-size: .85em; }
workout-detail .wd--zlegend i { display: inline-block; width: .7em; height: .7em; border-radius: 2px; margin-right: .4em; vertical-align: -.05em; }
workout-detail .wd--zlegend span { opacity: .85; font-variant-numeric: tabular-nums; }
workout-detail .wd--desc { margin-top: 1.4em; text-align: left; line-height: 1.55; opacity: .85; white-space: pre-line; font-size: 1.02em; }
workout-detail .wd--empty { opacity: .6; padding: 4em 0; }
`;

class WorkoutDetail extends HTMLElement {
    connectedCallback() {
        if(!document.getElementById('workout-detail-style')) {
            const el = document.createElement('style');
            el.id = 'workout-detail-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.workouts = [];
        this.loaded = null;      // db.workout
        this.preview = null;     // {source: 'library' | 'planned', id}
        this.ftp = 0;
        xf.sub('db:workouts', (w) => { this.workouts = w ?? []; this.render(); }, signal);
        xf.sub('db:workout', (w) => { this.loaded = w; this.render(); }, signal);
        xf.sub('db:ftp', (v) => { this.ftp = v; this.render(); }, signal);
        xf.sub('ui:workout:preview', (p) => { this.preview = p; this.render(); }, signal);
        this.addEventListener('click', (e) => this.onClick(e), signal);
        this.addEventListener('mousemove', (e) => this.onHover(e), signal);
        this.addEventListener('mouseleave', () => { if(this.dom?.info) this.dom.info.style.display = 'none'; }, signal);
        this.resize = debounce(() => this.render(), 150, {trailing: true, leading: false});
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(this);
        // crossing the desktop breakpoint (flux.css) shows or hides the pane
        this.mq = window.matchMedia('(min-width: 1200px) and (min-height: 650px) and (orientation: landscape)');
        this.mq.addEventListener('change', () => requestAnimationFrame(() => this.render()), signal);
    }
    disconnectedCallback() {
        this.abort.abort();
        this.ro?.disconnect();
    }

    // the workout to show: the one picked, or the one loaded
    current() {
        const p = this.preview;
        if(p?.source === 'library') {
            const w = this.workouts.find((x) => x.id === p.id);
            if(w) return {workout: w, source: 'library'};
        }
        if(p?.source === 'planned') {
            const w = models.planned.list().find((x) => x.id === p.id);
            if(w) return {workout: w, source: 'planned'};
        }
        if(this.loaded?.intervals) return {workout: this.loaded, source: null};
        return null;
    }

    onClick(e) {
        const btn = e.target.closest('button');
        if(!btn) return;
        const cur = this.current();
        if(!cur) return;
        const {workout, source} = cur;
        if(btn.dataset.act === 'load' || btn.dataset.act === 'ride') {
            xf.dispatch(source === 'planned' ? 'ui:planned:select' : 'ui:workout:select', workout.id);
            if(btn.dataset.act === 'ride') xf.dispatch('ui:page-set', 'home');
        }
    }

    onHover(e) {
        const bar = e.target.closest?.('.graph--bar');
        if(!bar || !this.dom?.info) return;
        const rect = this.dom.cont.getBoundingClientRect();
        renderInfo({
            power: bar.getAttribute('power'),
            cadence: bar.getAttribute('cadence'),
            slope: bar.getAttribute('slope'),
            duration: bar.getAttribute('duration'),
            intervalRect: bar.getBoundingClientRect(),
            contRect: {left: rect.left, width: rect.width},
            dom: this.dom,
        });
    }

    render() {
        // hidden: a phone width, or another tab. On a phone the group ride box
        // goes back to the loaded workout.
        if(this.offsetParent === null) {
            if(this.shownWorkout && getComputedStyle(this).display === 'none') {
                this.shownWorkout = null;
                xf.dispatch('workout-detail:shown', null);
            }
            return;
        }
        const cur = this.current();
        if(!cur) { this.innerHTML = '<div class="wd--empty">Pick a workout from the list.</div>'; return; }
        const {workout, source} = cur;
        const meta = workout.meta ?? {};
        const ftp = this.ftp || models.ftp.default || 200;
        const s = workoutStats(workout, ftp);
        const isLoaded = this.loaded?.id === workout.id;
        const when = meta.startDateLocal ? new Date(meta.startDateLocal).toLocaleDateString([], {weekday: 'long', month: 'short', day: 'numeric'}) : '';
        const sub = [meta.category && `<b>${esc(meta.category)}</b>`, source === 'planned' && when ? `planned for ${esc(when)}` : '', meta.author ? `by ${esc(meta.author)}` : '']
            .filter(Boolean).join(' · ');

        const width = Math.max(200, this.getBoundingClientRect().width);
        const graph = workout.intervals ? intervalsToGraph(workout, ftp, {width, height: 15 * parseFloat(getComputedStyle(this).fontSize), aspectRatio: 1}) : '';

        const zoneTotal = Object.values(s.zones).reduce((a, b) => a + b, 0) || 1;
        const zoneBar = ZONES.filter((z) => s.zones[z] > 0)
            .map((z) => `<span style="width:${(s.zones[z] / zoneTotal) * 100}%;background:var(${ZONE_VAR[z]})" title="${ZONE_NAME[z]} · ${clock(s.zones[z])}"></span>`).join('');
        const legend = ZONES.filter((z) => s.zones[z] > 0)
            .map((z) => `<div><i style="background:var(${ZONE_VAR[z]})"></i>${ZONE_NAME[z]} <span>${clock(s.zones[z])}</span></div>`).join('');

        const stat = (v, k) => `<div class="wd--stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
        const hasPower = s.powered > 0;

        this.innerHTML = `
            <div class="wd--head">
                <div class="wd--title"><h2>${esc(meta.name ?? 'Workout')}</h2>${sub ? `<div class="wd--sub">${sub}</div>` : ''}</div>
                <div class="wd--actions">
                    ${isLoaded ? '<span class="wd--loaded">✓ Loaded</span>' : '<button type="button" data-act="load">Load</button>'}
                    <button type="button" class="wd--primary" data-act="ride">${isLoaded ? 'Ride' : 'Load and ride'}</button>
                </div>
            </div>
            <div class="wd--stats">
                ${stat(clock(s.seconds), 'Time')}
                ${stat(hasPower ? s.tss : '–', 'TSS')}
                ${stat(hasPower ? s.IF.toFixed(2) : '–', 'IF')}
                ${stat(hasPower ? `${s.np}<small style="font-size:.5em;opacity:.7"> W</small>` : '–', 'NP')}
                ${stat(hasPower ? s.kj : '–', 'kJ')}
                ${stat(s.efforts, 'Over FTP')}
            </div>
            <div class="wd--graph"><div class="workout-list--graph-cont">${graph}</div></div>
            <div class="wd--axis"><span>0</span><span>${clock(s.seconds / 2)}</span><span>${clock(s.seconds)}</span></div>
            ${hasPower ? `<div class="wd--zones"><div class="wd--zbar">${zoneBar}</div><div class="wd--zlegend">${legend}</div></div>` : ''}
            ${meta.description ? `<div class="wd--desc">${esc(meta.description)}</div>` : ''}
            <div class="wd--note" style="margin-top:1em;font-size:.8em;opacity:.45;text-align:left">At your FTP of ${ftp} W.</div>`;
        this.dom = {cont: this.querySelector('.workout-list--graph-cont'), info: this.querySelector('.graph--info--cont')};
        if(this.shownWorkout !== workout) {
            this.shownWorkout = workout;
            xf.dispatch('workout-detail:shown', workout);
        }
    }
}

customElements.define('workout-detail', WorkoutDetail);

// the page became visible (the Workouts tab, a resize to desktop): draw now
xf.sub('db:page', (page) => {
    if(page !== 'workouts') return;
    requestAnimationFrame(() => document.querySelector('workout-detail')?.render());
});
