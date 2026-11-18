//
// Home (rider, Nov 18, 2026: "next up we gotta do a whole refresh of this home
// page. It's bad. looks like a mangled mobile page with no focus" … "go with
// A"). Built around the one thing the page is for: ride.
//
//   the hero     today's planned workout from intervals.icu (or the one you
//                picked below, or the one loaded): its name, graph and numbers
//                at your FTP, the devices it needs, and one big Ride button
//   this week    the planned week, Monday to Sunday; a day picks it into the
//                hero (or the button that connects intervals.icu)
//   the library  every workout as a card with its shape, filtered by type,
//                length and a search; a card picks it into the hero
//
// Ride loads the hero's workout and goes to the ride screen; pedalling starts
// it (start-page.js). The upstream lists (planned-list, workout-list) and the
// workout-detail pane stay in the page, hidden: they still carry the planned
// refresh, the file import and the group ride's workout.
//
import { xf, exists } from '../functions.js';
import { models } from '../models/models.js';
import { workoutStats } from './workout-detail.js';
import direct from '../models/intervals-direct.js';
import { core, details } from '../workout-core.js';

const ZONE_VAR = {
    one: '--zone-gray', two: '--zone-blue', three: '--zone-teal', four: '--zone-green',
    five: '--zone-yellow', six: '--zone-orange', seven: '--zone-red',
};
const LENGTHS = [['short', '< 45 min', (s) => s < 45 * 60], ['mid', '45–75 min', (s) => s >= 45 * 60 && s <= 75 * 60], ['long', '75 min +', (s) => s > 75 * 60]];
const DEVICES = [
    ['ble:controllable', 'Trainer'],
    ['ble:powerMeter', 'Power meter'],
    ['ble:heartRateMonitor', 'Heart rate'],
];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function clock(s) {
    const m = Math.round((s || 0) / 60);
    return m >= 90 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`;
}

// a card's details: the library's own workouts (workouts.js) carry their
// purpose only, so their structure with the watts goes first; anyone else's
// description is theirs, and the structure stands in only without one
export function aboutOf(w, frac, ftp) {
    const desc = (w?.meta?.description ?? '').trim();
    const shape = details(w, frac, ftp);
    if(w?.meta?.author === 'infERGno') return [shape, desc].filter(Boolean).join(' ');
    return desc || shape;
}

// TrainerRoad-style duration: 1:00:00
export function hms(s) {
    s = Math.round(s || 0);
    return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// Monday to Sunday around `now`, each day with what is planned on it
export function week(planned = [], now = new Date()) {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const today = dayKey(now);
    return DAYS.map((name, i) => {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const key = dayKey(d);
        return {name, key, today: key === today, past: key < today,
                workouts: planned.filter((w) => (w.meta?.startDateLocal ?? '').slice(0, 10) === key)};
    });
}

// the shape of a workout, as zone-coloured blocks, for any size
export function shape(workout, ftp, w, h, {gap = 0.6, line = false} = {}) {
    const steps = (workout?.intervals ?? []).flatMap((iv) => iv.steps ?? []).filter((st) => Number(st.duration) > 0);
    const total = steps.reduce((s, st) => s + Number(st.duration), 0);
    if(!total) return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"></svg>`;
    const max = 1.5;
    let x = 0;
    const bars = steps.map((st) => {
        const watts = exists(st.power) ? models.ftp.toAbsolute(st.power, ftp) : 0;
        const frac = ftp > 0 ? watts / ftp : 0;
        const bw = Number(st.duration) / total * w;
        const bh = Math.max(h * 0.06, Math.min(1, frac / max) * h);
        const zone = watts > 0 ? (models.ftp.powerToZone(watts, ftp)?.name ?? 'one') : 'one';
        const r = `<rect x="${x.toFixed(2)}" y="${(h - bh).toFixed(2)}" width="${Math.max(0.5, bw - (bw > gap * 3 ? gap : 0)).toFixed(2)}" height="${bh.toFixed(2)}" fill="var(${ZONE_VAR[zone]})"/>`;
        x += bw;
        return r;
    }).join('');
    const ftpLine = line ? `<line x1="0" x2="${w}" y1="${(h - h / max).toFixed(1)}" y2="${(h - h / max).toFixed(1)}" stroke="currentColor" stroke-opacity=".28" stroke-dasharray="4 4"/>` : '';
    return `<svg class="ht--shape" width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${ftpLine}${bars}</svg>`;
}

// the library as the rider has filtered it
export function filtered(list, {type = 'All', length = null, q = ''} = {}, seconds = (w) => 0) {
    const query = q.trim().toLowerCase();
    const len = LENGTHS.find(([k]) => k === length)?.[2];
    return list.filter((w) =>
        (type === 'All' || (w.meta?.category ?? 'Other') === type) &&
        (!len || len(seconds(w))) &&
        (!query || `${w.meta?.name ?? ''} ${w.meta?.category ?? ''} ${w.meta?.description ?? ''}`.toLowerCase().includes(query)));
}

const style = `
home-today { display: block; text-align: left; max-width: 1480px; margin: 0 auto; padding: 18px 16px 40px; box-sizing: border-box; color: var(--foreground-color, #e9eaee); }
home-today *, home-today *::before { box-sizing: border-box; }
home-today .ht--kicker { font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: var(--gray, #8f96a3); font-weight: 600; }
home-today .ht--muted { opacity: .62; }
home-today .ht--hero-title .ht--muted { font-size: 15px; }
home-today .ht--graph .ht--shape { height: 170px; }
home-today .ht--top { display: grid; gap: 22px; }
home-today .ht--hero { border-radius: 20px; padding: 20px; background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.02)); border: 1px solid rgba(255,255,255,.09); }
home-today .ht--hero-head { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
home-today .ht--hero-title { flex: 1 1 280px; min-width: 0; }
home-today .ht--hero h2 { margin: 6px 0 2px; font-size: 30px; line-height: 1.15; font-weight: 800; overflow-wrap: anywhere; }
home-today .ht--go { flex: none; text-align: right; }
home-today .ht--ride { display: inline-flex; align-items: center; gap: 10px; border: 0; border-radius: 14px; cursor: pointer;
    background: var(--zone-green, #3fd08a); color: #0d1a12; font: 800 20px/1 system-ui, sans-serif; padding: 16px 34px; }
home-today .ht--ride:hover { filter: brightness(1.08); }
home-today .ht--hint { font-size: 12.5px; opacity: .6; margin-top: 8px; }
home-today .ht--graph { margin: 18px 0 12px; color: var(--foreground-color, #fff); }
home-today .ht--axis { display: flex; justify-content: space-between; font-size: 12px; opacity: .5; font-variant-numeric: tabular-nums; margin-top: 4px; }
home-today .ht--foot { display: flex; align-items: center; gap: 14px 26px; flex-wrap: wrap; }
home-today .ht--stats { display: flex; gap: 24px; flex-wrap: wrap; }
home-today .ht--stat b { display: block; font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
home-today .ht--stat span { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .6; }
home-today .ht--devices { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
home-today .ht--dev { display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px; font-size: 13px; border: 0; cursor: pointer;
    background: rgba(255,255,255,.07); color: inherit; font-family: inherit; }
home-today .ht--dev i { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; display: inline-block; }
home-today .ht--dev.on i { background: #3fd08a; }
home-today .ht--dev.loading i { background: #f2c94c; animation: ht-pulse 1s infinite alternate; }
home-today .ht--dev u { opacity: .85; }
home-today .ht--dev.on { cursor: default; }
@keyframes ht-pulse { to { opacity: .3; } }
home-today .ht--desc { margin-top: 14px; font-size: 14px; line-height: 1.5; opacity: .72; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
home-today .ht--side { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
home-today .ht--side-head { display: flex; align-items: center; justify-content: space-between; margin: 2px 2px 4px; }
home-today .ht--side-head button { background: none; border: 0; color: inherit; opacity: .6; cursor: pointer; font-size: 15px; }
home-today .ht--day { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 12px; background: rgba(255,255,255,.035); border: 1px solid transparent;
    cursor: pointer; color: inherit; font: inherit; text-align: left; width: 100%; }
home-today .ht--day.rest { cursor: default; }
home-today .ht--day.today { border-color: rgba(63,208,138,.45); background: rgba(255,255,255,.07); }
home-today .ht--day.shown { background: rgba(255,255,255,.1); }
home-today .ht--day.past { opacity: .55; }
home-today .ht--day .d { width: 34px; font-size: 12px; font-weight: 700; opacity: .65; flex: none; }
home-today .ht--day.today .d { color: #3fd08a; opacity: 1; }
home-today .ht--day .n { flex: 1; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
home-today .ht--day.rest .n { opacity: .5; }
home-today .ht--day .s { width: 92px; flex: none; }
home-today .ht--connect { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; cursor: pointer; border: 1px dashed rgba(255,255,255,.2);
    background: none; color: inherit; font: 600 14px system-ui, sans-serif; text-align: left; }
home-today .ht--connect svg { width: 22px; height: 22px; flex: none; }
home-today strava-home { margin: 10px 0 0 !important; }
home-today .ht--lib { margin-top: 30px; }
home-today .ht--lib-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
home-today .ht--lib-head h3 { margin: 0 10px 0 0; font-size: 18px; }
home-today .ht--chip { padding: 7px 13px; border-radius: 999px; border: 0; cursor: pointer; font: 13px system-ui, sans-serif; white-space: nowrap;
    background: rgba(255,255,255,.07); color: inherit; }
home-today .ht--chip.on { background: var(--foreground-color, #e9eaee); color: var(--background-color, #14161b); font-weight: 600; }
home-today .ht--gap { width: 10px; flex: none; }
home-today .ht--chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
home-today .ht--search { margin-left: auto; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05);
    color: inherit; font: 14px system-ui, sans-serif; min-width: 220px; }
home-today .ht--import { background: none; border: 0; color: inherit; opacity: .6; cursor: pointer; font: 13px system-ui, sans-serif; text-decoration: underline; }
home-today .ht--grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(520px, 1fr)); gap: 14px; }
home-today .ht--card { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 4px 18px; text-align: left; padding: 14px; border-radius: 12px; cursor: pointer;
    color: inherit; font: inherit; background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.08); }
home-today .ht--card:hover { background: rgba(255,255,255,.06); }
home-today .ht--card.shown { border-color: rgba(63,208,138,.6); }
home-today .ht--card .g { background: rgba(0,0,0,.32); border-radius: 6px; padding: 6px 4px 0; align-self: start; color: var(--foreground-color, #fff); }
home-today .ht--card .g .ht--shape { height: 92px; display: block; }
home-today .ht--card .name { font-size: 20px; font-weight: 800; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
home-today .ht--card .kind { font-size: 14px; opacity: .78; margin-top: 2px; }
home-today .ht--card .kind b { font-weight: 600; opacity: 1; }
home-today .ht--card .nums { display: flex; gap: 18px; margin-top: 10px; }
home-today .ht--card .nums b { display: block; font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
home-today .ht--card .nums span { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; opacity: .6; }
home-today .ht--card .det { grid-column: 1 / -1; margin-top: 8px; font-size: 13.5px; line-height: 1.45; opacity: .8;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
home-today .ht--card .det b { opacity: 1; font-weight: 700; }
home-today .ht--empty { opacity: .6; padding: 20px 0; }
home-today group-create { display: block; margin-top: 30px; }
@media (min-width: 900px) {
    home-today { padding: 26px 32px 48px; }
    home-today .ht--top { grid-template-columns: minmax(0, 1fr) 340px; gap: 26px; }
    home-today .ht--hero { padding: 24px 28px; }
    home-today .ht--hero h2 { font-size: 34px; }
}
@media (max-width: 899px) {
    home-today .ht--go { flex: 1 1 100%; text-align: left; order: 3; }
    home-today .ht--graph .ht--shape { height: 110px; }
    home-today .ht--hero h2 { font-size: 26px; }
    home-today .ht--ride { width: 100%; justify-content: center; }
    home-today .ht--devices { margin-left: 0; }
    home-today .ht--search { min-width: 0; flex: 1 1 100%; margin-left: 0; }
    home-today .ht--chips { flex: 1 1 100%; flex-wrap: nowrap; overflow-x: auto; margin: 0 -16px; padding: 2px 16px; scrollbar-width: none; }
    home-today .ht--chips::-webkit-scrollbar { display: none; }
    home-today .ht--grid { grid-template-columns: 1fr; gap: 10px; }
    home-today .ht--card { grid-template-columns: 112px minmax(0, 1fr); gap: 2px 12px; padding: 12px; }
    home-today .ht--card .g .ht--shape { height: 64px; }
    home-today .ht--card .name { font-size: 17px; }
    home-today .ht--card .kind { font-size: 13px; }
    home-today .ht--card .nums { gap: 12px; margin-top: 6px; }
    home-today .ht--card .nums b { font-size: 14.5px; }
}
`;

class HomeToday extends HTMLElement {
    connectedCallback() {
        if(!document.getElementById('home-today-style')) {
            const el = document.createElement('style');
            el.id = 'home-today-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.$hero = this.querySelector('.ht--hero');
        this.$week = this.querySelector('.ht--week');
        this.$lib = this.querySelector('.ht--lib');
        this.library = [];
        this.loaded = null;
        this.picked = null;              // {source: 'planned' | 'library', id}
        this.ftp = 0;
        this.filter = {type: 'All', length: null, q: ''};
        this.devices = Object.fromEntries(DEVICES.map(([id]) => [id, {status: 'off', name: null}]));
        this.seconds = new WeakMap();

        xf.sub('db:workouts', (w) => { this.library = Array.isArray(w) ? w : []; this.seconds = new WeakMap(); this.renderAll(); }, signal);
        xf.sub('db:workout', (w) => { this.loaded = w; this.renderHero(); }, signal);
        xf.sub('db:ftp', (v) => { this.ftp = v; this.seconds = new WeakMap(); this.renderAll(); }, signal);
        xf.sub('action:planned', (a) => { if(a === ':data' || /:wod:(success|fail)$/.test(a)) this.renderAll(); }, signal);
        xf.sub('services', () => this.renderWeek(), signal);
        for(const [id] of DEVICES) {
            xf.sub(`${id}:connected`, () => { this.devices[id].status = 'on'; this.renderDevices(); }, signal);
            xf.sub(`${id}:disconnected`, () => { this.devices[id].status = 'off'; this.renderDevices(); }, signal);
            xf.sub(`${id}:connecting`, () => { this.devices[id].status = 'loading'; this.renderDevices(); }, signal);
            xf.sub(`${id}:name`, (n) => { this.devices[id].name = n && n !== '--' ? n : null; this.renderDevices(); }, signal);
        }
        this.addEventListener('click', (e) => this.onClick(e), signal);
        this.addEventListener('input', (e) => {
            if(!e.target.matches('.ht--search')) return;
            this.filter.q = e.target.value;
            this.renderGrid();
        }, signal);
        this.renderAll();
    }
    disconnectedCallback() { this.abort.abort(); }

    ftpNow() { return this.ftp || models.ftp.default || 200; }
    secondsOf(w) {
        if(!this.seconds.has(w)) this.seconds.set(w, (w.intervals ?? []).flatMap((iv) => iv.steps ?? []).reduce((s, st) => s + (Number(st.duration) || 0), 0));
        return this.seconds.get(w);
    }
    planned() { try { return models.planned.list() ?? []; } catch(e) { return []; } }

    // the hero: what was picked, else today's plan, else what is loaded, else the first in the library
    hero() {
        const planned = this.planned();
        if(this.picked) {
            const w = (this.picked.source === 'planned' ? planned : this.library).find((x) => String(x.id) === this.picked.id);
            if(w) return {workout: w, source: this.picked.source, why: 'picked'};
        }
        const today = dayKey(new Date());
        const t = planned.find((w) => (w.meta?.startDateLocal ?? '').slice(0, 10) === today);
        if(t) return {workout: t, source: 'planned', why: 'today'};
        if(this.loaded?.intervals) return {workout: this.loaded, source: this.loaded.meta?.startDateLocal ? 'planned' : 'library', why: 'loaded'};
        if(this.library[0]) return {workout: this.library[0], source: 'library', why: 'first'};
        return null;
    }

    renderAll() { this.renderHero(); this.renderWeek(); this.renderLib(); }

    renderHero() {
        if(!this.$hero) return;
        const h = this.hero();
        this.shown = h;
        if(!h) { this.$hero.innerHTML = '<div class="ht--empty">Pick a workout below.</div>'; return; }
        const {workout, source, why} = h;
        const meta = workout.meta ?? {};
        const ftp = this.ftpNow();
        const s = workoutStats(workout, ftp);
        const when = meta.startDateLocal ? new Date(meta.startDateLocal) : null;
        const kicker = why === 'today' ? `Today · ${new Date().toLocaleDateString([], {weekday: 'long'})} · from intervals.icu`
            : source === 'planned' && when ? `Planned for ${when.toLocaleDateString([], {weekday: 'long', month: 'short', day: 'numeric'})}`
            : why === 'loaded' ? 'Loaded' : 'From the library';
        const frac = (p) => models.ftp.toAbsolute(p, ftp) / ftp;
        const sub = [meta.category, core(workout, frac) || clock(s.seconds)].filter(Boolean).join(' · ');
        const about = aboutOf(workout, frac, ftp);
        const hasPower = s.powered > 0;
        const stat = (v, k) => `<div class="ht--stat"><b>${v}</b><span>${k}</span></div>`;
        this.$hero.innerHTML = `
            <div class="ht--hero-head">
                <div class="ht--hero-title"><div class="ht--kicker">${esc(kicker)}</div><h2>${esc(meta.name ?? 'Workout')}</h2><div class="ht--muted">${esc(sub)}</div></div>
                <div class="ht--go"><button type="button" class="ht--ride" data-act="ride">▶ Ride</button><div class="ht--hint">Start pedalling and it starts itself</div></div>
            </div>
            <div class="ht--graph">${shape(workout, ftp, 900, 170, {line: true})}<div class="ht--axis"><span>0</span><span>${clock(s.seconds / 2)}</span><span>${clock(s.seconds)}</span></div></div>
            <div class="ht--foot">
                <div class="ht--stats">
                    ${stat(clock(s.seconds), 'Time')}
                    ${hasPower ? stat(s.tss, 'TSS') + stat(s.IF.toFixed(2), 'IF') + stat(`${s.np} W`, `NP at FTP ${ftp}`) : ''}
                </div>
                <div class="ht--devices"></div>
            </div>
            ${about ? `<div class="ht--desc">${esc(about)}</div>` : ''}`;
        this.renderDevices();
        // the group ride hosts the workout shown here (group-views.js)
        xf.dispatch('workout-detail:shown', workout);
        this.querySelectorAll('.ht--day, .ht--card').forEach((el) => el.classList.toggle('shown', el.dataset.id === String(workout.id) && el.dataset.source === source));
    }

    renderDevices() {
        const box = this.querySelector('.ht--devices');
        if(!box) return;
        box.innerHTML = DEVICES.map(([id, label]) => {
            const d = this.devices[id];
            const text = d.status === 'on' ? `${label}${d.name ? ` · ${esc(d.name)}` : ''}` : d.status === 'loading' ? `${label} · connecting` : `${label} <u>connect</u>`;
            return `<button type="button" class="ht--dev ${d.status}" data-dev="${id}" title="${d.status === 'on' ? 'Connected' : 'Connect'}"><i></i>${text}</button>`;
        }).join('');
    }

    renderWeek() {
        if(!this.$week) return;
        if(!direct.isConfigured()) {
            this.$week.innerHTML = `<div class="ht--side-head"><span class="ht--kicker">This week</span></div>
                <button type="button" class="ht--connect" data-act="intervals"><svg><use href="#icon--intervals"/></svg><span>Connect intervals.icu to show planned workouts</span></button>`;
            return;
        }
        const ftp = this.ftpNow();
        const days = week(this.planned());
        this.$week.innerHTML = `<div class="ht--side-head"><span class="ht--kicker">This week</span><button type="button" data-act="refresh" title="Fetch the plan from intervals.icu again">↻</button></div>` +
            days.map((d) => {
                const w = d.workouts[0];
                const cls = ['ht--day', d.today ? 'today' : '', d.past ? 'past' : '', w ? '' : 'rest'].join(' ');
                return `<button type="button" class="${cls}" ${w ? `data-id="${esc(w.id)}" data-source="planned"` : 'disabled'}>
                    <span class="d">${d.name}</span><span class="n">${esc(w ? w.meta?.name : 'Rest')}${d.workouts.length > 1 ? ` +${d.workouts.length - 1}` : ''}</span>
                    ${w ? `<span class="s">${shape(w, ftp, 92, 22, {gap: 0.3})}</span>` : ''}</button>`;
            }).join('');
        const shown = this.shown;
        if(shown) this.$week.querySelectorAll('.ht--day').forEach((el) => el.classList.toggle('shown', el.dataset.id === String(shown.workout.id) && shown.source === 'planned'));
    }

    renderLib() {
        if(!this.$lib) return;
        const types = ['All', ...new Set(this.library.map((w) => w.meta?.category ?? 'Other'))];
        const chip = (attr, val, label, on) => `<button type="button" class="ht--chip ${on ? 'on' : ''}" data-${attr}="${esc(val)}">${esc(label)}</button>`;
        this.$lib.innerHTML = `
            <div class="ht--lib-head">
                <h3>Or ride something else</h3>
                <div class="ht--chips">
                    ${types.map((t) => chip('type', t, t, this.filter.type === t)).join('')}
                    <span class="ht--gap"></span>
                    ${LENGTHS.map(([k, label]) => chip('length', k, label, this.filter.length === k)).join('')}
                </div>
                <input class="ht--search" type="search" placeholder="Search ${this.library.length} workouts" value="${esc(this.filter.q)}">
                <button type="button" class="ht--import" data-act="import">Import a file</button>
            </div>
            <div class="ht--grid"></div>`;
        this.renderGrid();
    }

    renderGrid() {
        const grid = this.querySelector('.ht--grid');
        if(!grid) return;
        const ftp = this.ftpNow();
        const list = filtered(this.library, this.filter, (w) => this.secondsOf(w));
        const shown = this.shown;
        const frac = (p) => models.ftp.toAbsolute(p, ftp) / ftp;
        grid.innerHTML = list.length ? list.map((w) => {
            const s = workoutStats(w, ftp);
            const on = shown && shown.source === 'library' && String(shown.workout.id) === String(w.id);
            const main = core(w, frac);
            const about = aboutOf(w, frac, ftp);
            return `<button type="button" class="ht--card ${on ? 'shown' : ''}" data-id="${esc(w.id)}" data-source="library">
                <div class="g">${shape(w, ftp, 300, 92, {gap: 0.4, line: true})}</div>
                <div>
                    <div class="name">${esc(w.meta?.name ?? 'Workout')}</div>
                    <div class="kind"><b>${esc(w.meta?.category ?? 'Workout')}</b>${main ? ` · ${esc(main)}` : ''}</div>
                    <div class="nums"><div><b>${hms(s.seconds)}</b><span>Duration</span></div>${s.powered ? `<div><b>${s.tss}</b><span>TSS</span></div><div><b>${s.IF.toFixed(2)}</b><span>IF</span></div><div><b>${s.kj}</b><span>kJ</span></div>` : ''}</div>
                </div>
                ${about ? `<div class="det"><b>Details:</b> ${esc(about)}</div>` : ''}
            </button>`;
        }).join('') : '<div class="ht--empty">No workouts match.</div>';
    }

    onClick(e) {
        const el = e.target.closest('button');
        if(!el || !this.contains(el)) return;
        if(el.dataset.act === 'ride') {
            const h = this.shown;
            if(!h) return;
            xf.dispatch(h.source === 'planned' ? 'ui:planned:select' : 'ui:workout:select', h.workout.id);
            xf.dispatch('home:pick', {name: h.workout.meta?.name ?? null, source: h.source, ride: true});
            xf.dispatch('ui:page-set', 'home');
            return;
        }
        if(el.dataset.dev) {
            if(this.devices[el.dataset.dev].status === 'off') xf.dispatch(`ui:${el.dataset.dev}:switch`);
            return;
        }
        if(el.dataset.act === 'intervals') {
            xf.dispatch('ui:page-set', 'settings');
            setTimeout(() => document.querySelector('intervals-direct-settings')?.scrollIntoView({block: 'center', behavior: 'smooth'}), 150);
            return;
        }
        if(el.dataset.act === 'refresh') { xf.dispatch('action:planned', ':intervals:wod'); return; }
        if(el.dataset.act === 'import') { document.querySelector('#workout-file')?.click(); return; }
        if(el.dataset.type) { this.filter.type = el.dataset.type; this.renderLib(); return; }
        if(el.dataset.length) { this.filter.length = this.filter.length === el.dataset.length ? null : el.dataset.length; this.renderLib(); return; }
        if(el.dataset.id && el.dataset.source) {
            this.picked = {source: el.dataset.source, id: el.dataset.id};
            const w = (el.dataset.source === 'planned' ? this.planned() : this.library).find((x) => String(x.id) === el.dataset.id);
            xf.dispatch('home:pick', {name: w?.meta?.name ?? null, source: el.dataset.source});
            this.renderHero();
            this.renderWeek();
            this.renderGrid();
            if(window.innerWidth < 900) this.$hero.scrollIntoView({behavior: 'smooth', block: 'start'});
        }
    }
}

customElements.define('home-today', HomeToday);
export { HomeToday };
