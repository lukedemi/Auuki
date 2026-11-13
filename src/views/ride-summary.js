//
// The end of a ride (rider, Nov 13, 2026: "when you end workout, it should
// allow you to name the workout if you want, set your RPE, and set your how
// you're feeling, etc. … That's where the image should live as well, and the
// buttons. For uploading to Strava and intervals. You should never have to
// click save though").
//
// Opens by itself when a ride stops (the ride is already saved by then:
// models.js Activity.createFromCurrent), and from the image button on any
// saved activity. Every field is written to the saved ride as it changes;
// there is nothing to save and nothing to lose by closing it. Once the ride
// is on intervals.icu, name, RPE, feel and notes follow it there too.
//
// Feel is intervals.icu's: 1 is the best, 5 the worst.
//

import { xf } from '../functions.js';
import { models } from '../models/models.js';
import direct from '../models/intervals-direct.js';
import { roomSummary } from '../room.js';
import { recordChart, cleanTitle, cardModel, cardSvg, svgToPng, fileName as pngName, downloadBlob } from '../ride-card.js';

const FEEL = [[1, 'Very strong'], [2, 'Strong'], [3, 'Normal'], [4, 'Meh'], [5, 'Weak']];
const RPE_WORDS = {1: 'very easy', 3: 'easy', 5: 'moderate', 7: 'hard', 9: 'very hard', 10: 'max'};

const style = `
ride-summary { display: none; }
ride-summary.open {
    display: block; position: fixed; inset: 0; z-index: 9995; overflow-y: auto;
    background: rgba(8, 9, 12, 0.82); backdrop-filter: blur(3px);
    color: var(--foreground-color, #eee); font-family: system-ui, sans-serif;
}
ride-summary .rs--card {
    max-width: 1180px; margin: 3vh auto; padding: 22px 26px 26px; box-sizing: border-box;
    background: var(--background-color, #1b1d22); border: 1px solid var(--border-color, #333); border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55); text-align: left; font-size: 16px;
}
ride-summary .rs--top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
ride-summary .rs--saved { font-size: 15px; padding: 4px 12px; border-radius: 999px; background: rgba(39, 174, 96, 0.18); color: #6fdc9b; }
ride-summary .rs--saved.bad { background: rgba(235, 87, 87, 0.2); color: #ff8c8c; }
ride-summary .rs--done { margin-left: auto; }
ride-summary input.rs--name {
    width: 100%; box-sizing: border-box; margin: 14px 0 6px; padding: 8px 10px;
    font: 700 30px/1.2 system-ui, sans-serif; color: inherit;
    background: transparent; border: 1px solid transparent; border-radius: 8px;
}
ride-summary input.rs--name:hover, ride-summary input.rs--name:focus { border-color: var(--border-color, #444); outline: none; background: rgba(255,255,255,0.03); }
ride-summary .rs--stats { display: flex; flex-wrap: wrap; gap: 6px 34px; margin: 4px 10px 16px; }
ride-summary .rs--stat b { display: block; line-height: 1.15; font-size: 27px; font-variant-numeric: tabular-nums; }
ride-summary .rs--stat span { display: block; line-height: 1.3; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; }
ride-summary .rs--room { margin: -8px 10px 16px; font-size: 15px; opacity: 0.75; font-variant-numeric: tabular-nums; }
ride-summary .rs--grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(300px, 1fr); gap: 26px; align-items: start; }
@media (max-width: 900px) { ride-summary .rs--grid { grid-template-columns: 1fr; } }
ride-summary .rs--img {
    width: 100%; aspect-ratio: 1600 / 1000; border-radius: 10px; background: #14161b; display: block; object-fit: contain;
}
ride-summary h3 { margin: 0 0 8px; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.65; font-weight: 600; }
ride-summary section + section { margin-top: 20px; }
ride-summary .rs--scale { display: grid; gap: 6px; }
ride-summary .rs--rpe { grid-template-columns: repeat(10, 1fr); }
ride-summary .rs--feel { grid-template-columns: repeat(5, 1fr); }
ride-summary .rs--scale button { padding: 10px 0; font: 600 17px system-ui, sans-serif; }
ride-summary .rs--feel button { font-size: 14px; padding: 10px 2px; }
ride-summary .rs--hint { font-size: 14px; opacity: 0.6; min-height: 1.2em; margin-top: 6px; }
ride-summary button {
    color: inherit; background: var(--chrome, #2a2d34); border: 1px solid var(--border-color, #3a3d45);
    border-radius: 8px; padding: 9px 16px; font: 600 15px system-ui, sans-serif; cursor: pointer;
}
ride-summary button:hover { filter: brightness(1.2); }
ride-summary button.on { background: #2f80ed; border-color: #2f80ed; color: #fff; }
ride-summary button.primary { background: #2f80ed; border-color: #2f80ed; color: #fff; }
ride-summary button:disabled { opacity: 0.55; cursor: progress; }
ride-summary textarea {
    width: 100%; box-sizing: border-box; min-height: 92px; padding: 10px; resize: vertical;
    font: 16px/1.4 system-ui, sans-serif; color: inherit; background: rgba(255,255,255,0.03);
    border: 1px solid var(--border-color, #3a3d45); border-radius: 8px;
}
ride-summary .rs--row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
ride-summary .rs--up { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
ride-summary .rs--up button { min-width: 220px; white-space: nowrap; }
ride-summary .rs--up .ok { color: #6fdc9b; }
ride-summary .rs--up .bad { color: #ff8c8c; }
ride-summary .rs--up a { color: #8ab8ff; }
ride-summary .rs--files { margin-top: 10px; }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// "Room 62.4 → 65.1°F · 50 → 55% · CO₂ 660 → 1,120 ppm (max 1,180) · fans: front 48 min"
export function roomLine(r) {
    if(!r) return '';
    const fmt = (n, d = 0) => n.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
    const span = (x, d, unit) => x.from === x.to ? `${fmt(x.from, d)}${unit}` : `${fmt(x.from, d)} → ${fmt(x.to, d)}${unit}`;
    const parts = [];
    if(r.temp) parts.push(span(r.temp, 1, '°F'));
    if(r.hum) parts.push(span(r.hum, 0, '%'));
    if(r.co2) parts.push(`CO₂ ${span(r.co2, 0, ' ppm')}${r.co2.max > Math.max(r.co2.from, r.co2.to) ? ` (max ${fmt(r.co2.max)})` : ''}`);
    const fans = [r.front && `front ${r.front} min`, r.rear && `rear ${r.rear} min`].filter(Boolean);
    parts.push(fans.length ? `fans: ${fans.join(', ')}` : 'fans off');
    return parts.length ? `Room  ${parts.join(' · ')}` : '';
}

let loadedWorkout = null;
xf.sub('db:workout', (w) => loadedWorkout = w);

// A ride saved before rides kept their plan: the workout it followed is the
// one still loaded if the names match, else that day's planned workout of the
// same name on intervals.icu.
export async function plannedWorkoutFor(summary = {}, {loaded = loadedWorkout, events = direct.events, fromEvent = (e) => models.workout.fromIntervalsEvent(e)} = {}) {
    const want = cleanTitle(summary.name);
    if(!want) return null;
    if(loaded?.intervals?.length && cleanTitle(loaded.meta?.name) === want) return loaded;
    if(!direct.isConfigured()) return null;
    try {
        const d = new Date(summary.timestamp ?? Date.now());
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const found = (await events(day, day)).find((e) => cleanTitle(e.name) === want);
        if(!found) return null;
        const workout = fromEvent(found);
        workout.meta = Object.assign({}, workout.meta, {name: found.name});
        return workout;
    } catch(e) {
        console.warn('ride summary: no planned workout from intervals.icu', e);
        return null;
    }
}

class RideSummary extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = {signal: this.abortController.signal};
        if(!document.getElementById('ride-summary-style')) {
            const el = document.createElement('style');
            el.id = 'ride-summary-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.rideId = null;
        this.summary = null;

        xf.sub('activity:add', (s) => { if(s?.id) this.open(s.id); }, signal);
        xf.sub('activity:save:fail', (msg) => this.openFailed(msg), signal);
        xf.sub('ui:ride-summary:open', (id) => this.open(id), signal);
        xf.sub('activity:updated', (s) => { if(s?.id === this.rideId) { this.summary = s; this.renderUploads(); } }, signal);
        xf.sub('watch:started', () => this.close(), signal);
        window.addEventListener('keydown', (e) => {
            if(e.key === 'Escape' && this.classList.contains('open')) this.close();
        }, signal);
        this.addEventListener('pointerdown', (e) => { if(e.target === this) this.close(); }, signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }

    close() {
        this.flush();
        this.classList.remove('open');
        if(this.imgUrl) { URL.revokeObjectURL(this.imgUrl); this.imgUrl = null; }
    }

    openFailed(msg) {
        this.rideId = null;
        this.innerHTML = `<div class="rs--card">
            <div class="rs--top"><span class="rs--saved bad">Not saved in this browser</span>
                <button class="rs--done" type="button">Close</button></div>
            <p style="font-size:1.1rem;line-height:1.5">${esc(msg)}. Your Downloads folder has the .fit.
            The ride also stays in the session backup, and comes back when the page reloads.</p></div>`;
        this.querySelector('.rs--done').onclick = () => this.close();
        this.classList.add('open');
    }

    async open(id) {
        const record = await models.activity.get(id);
        if(!record) return;
        this.rideId = id;
        this.record = record;
        this.summary = record.summary;
        this.chart = null;
        this.render();
        this.classList.add('open');
        try {
            const workout = record.chart?.t?.length ? null : await plannedWorkoutFor(record.summary);
            this.chart = await recordChart(record, {workout, toAbsolute: (v, ftp) => models.ftp.toAbsolute(v, ftp)});
        } catch(e) {
            console.warn('ride summary: no chart', e);
        }
        this.renderStats();
        this.renderImage();
    }

    render() {
        const s = this.summary;
        const when = new Date(s.timestamp).toLocaleString([], {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
        this.innerHTML = `<div class="rs--card">
            <div class="rs--top">
                <span class="rs--saved">✓ Saved on this computer</span>
                <span style="opacity:0.6">${esc(when)}</span>
                <button class="rs--done primary" type="button">Done</button>
            </div>
            <input class="rs--name" type="text" maxlength="120" aria-label="Ride name" placeholder="Name this ride">
            <div class="rs--stats"></div>
            <div class="rs--room"></div>
            <div class="rs--grid">
                <div>
                    <img class="rs--img" alt="The ride, drawn for Strava">
                    <div class="rs--row rs--files">
                        <button type="button" data-file="png">Save image</button>
                        <button type="button" data-file="fit">Download .fit</button>
                    </div>
                </div>
                <div>
                    <section>
                        <h3>How hard (RPE)</h3>
                        <div class="rs--scale rs--rpe">${Array.from({length: 10}, (_, i) => `<button type="button" data-rpe="${i + 1}">${i + 1}</button>`).join('')}</div>
                        <div class="rs--hint" data-hint="rpe"></div>
                    </section>
                    <section>
                        <h3>How you felt</h3>
                        <div class="rs--scale rs--feel">${FEEL.map(([v, l]) => `<button type="button" data-feel="${v}">${l}</button>`).join('')}</div>
                    </section>
                    <section>
                        <h3>Notes</h3>
                        <textarea class="rs--notes" placeholder="Anything worth remembering"></textarea>
                        <div class="rs--hint" data-hint="saved"></div>
                    </section>
                    <section>
                        <h3>Upload</h3>
                        <div class="rs--up" data-up="intervals"></div>
                    </section>
                </div>
            </div>
        </div>`;

        this.$name = this.querySelector('.rs--name');
        this.$notes = this.querySelector('.rs--notes');
        this.$name.value = s.name ?? '';
        this.$notes.value = s.notes ?? '';

        this.querySelector('.rs--done').onclick = () => this.close();
        this.$name.addEventListener('input', () => this.edit({name: this.$name.value.trim() || 'Ride'}, 600, true));
        this.$notes.addEventListener('input', () => this.edit({notes: this.$notes.value}, 800));
        this.querySelectorAll('[data-rpe]').forEach((b) => b.onclick = () => {
            const v = Number(b.dataset.rpe);
            this.edit({rpe: this.summary.rpe === v ? null : v}, 0);
        });
        this.querySelectorAll('[data-feel]').forEach((b) => b.onclick = () => {
            const v = Number(b.dataset.feel);
            this.edit({feel: this.summary.feel === v ? null : v}, 0);
        });
        this.querySelector('[data-file="png"]').onclick = (e) => this.savePng(e.currentTarget);
        this.querySelector('[data-file="fit"]').onclick = () => models.activity.download(this.rideId);
        this.renderScales();
        this.renderUploads();
    }

    renderScales() {
        const s = this.summary;
        this.querySelectorAll('[data-rpe]').forEach((b) => b.classList.toggle('on', Number(b.dataset.rpe) === s.rpe));
        this.querySelectorAll('[data-feel]').forEach((b) => b.classList.toggle('on', Number(b.dataset.feel) === s.feel));
        const word = s.rpe ? (RPE_WORDS[s.rpe] ?? RPE_WORDS[s.rpe - 1] ?? '') : '';
        const $h = this.querySelector('[data-hint="rpe"]');
        if($h) $h.textContent = s.rpe ? `${s.rpe} / 10${word ? ` · ${word}` : ''}` : '1 very easy · 10 max';
    }

    renderStats() {
        const $s = this.querySelector('.rs--stats');
        if(!$s) return;
        if(!this.chart?.t?.length) { $s.innerHTML = ''; return; }
        const m = cardModel(this.chart, {name: this.summary.name});
        const avg = Math.round(this.chart.w.reduce((a, b) => a + b, 0) / this.chart.w.length);
        const stats = [m.stats[0], [`${avg} W`, 'avg power'], ...m.stats.slice(1)];
        $s.innerHTML = stats.map(([v, l]) => `<div class="rs--stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
        const $room = this.querySelector('.rs--room');
        if($room) $room.textContent = roomLine(roomSummary(this.chart.room ?? []));
    }

    renderImage() {
        const $img = this.querySelector('.rs--img');
        if(!$img || !this.chart?.t?.length) return;
        const svg = cardSvg(cardModel(this.chart, {name: this.summary.name}));
        if(this.imgUrl) URL.revokeObjectURL(this.imgUrl);
        this.imgUrl = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
        $img.src = this.imgUrl;
        this.svg = svg;
    }

    async savePng($btn) {
        if(!this.chart?.t?.length) { alert('This ride has nothing to draw.'); return; }
        $btn.disabled = true;
        try {
            const png = await svgToPng(cardSvg(cardModel(this.chart, {name: this.summary.name})));
            const name = pngName(this.summary.timestamp);
            const file = typeof File === 'function' ? new File([png], name, {type: 'image/png'}) : null;
            if(window.matchMedia?.('(pointer: coarse)')?.matches && file && navigator.canShare?.({files: [file]})) {
                try { await navigator.share({files: [file]}); return; }
                catch(e) { if(e.name === 'AbortError') return; }
            }
            downloadBlob(png, name);
        } catch(e) {
            alert(`The image did not draw: ${e.message}`);
        } finally {
            $btn.disabled = false;
        }
    }

    // ------------------------------------------------------------ editing

    edit(fields, wait = 0, redraw = false) {
        Object.assign(this.summary, fields);
        this.renderScales();
        this.pending = Object.assign(this.pending ?? {}, fields);
        this.redraw = this.redraw || redraw;
        clearTimeout(this.timer);
        if(wait) this.timer = setTimeout(() => this.flush(), wait);
        else this.flush();
    }

    async flush() {
        clearTimeout(this.timer);
        if(!this.pending || !this.rideId) return;
        const fields = this.pending, id = this.rideId, redraw = this.redraw;
        this.pending = null;
        this.redraw = false;
        const $h = this.querySelector('[data-hint="saved"]');
        try {
            const summary = await models.activity.update(id, fields);
            if($h && id === this.rideId) $h.textContent = '✓ Saved';
            if(redraw && id === this.rideId) { this.renderImage(); }
            if(summary?.intervals_id) this.pushIntervals(summary);
        } catch(e) {
            if($h) $h.textContent = `Not saved: ${e.message}`;
        }
    }

    // the edits follow the ride onto intervals.icu, a second after the last one
    pushIntervals(summary) {
        if(!direct.isConfigured()) return;
        clearTimeout(this.icuTimer);
        this.icuTimer = setTimeout(async () => {
            const $h = this.querySelector('[data-hint="saved"]');
            try {
                await direct.updateActivity(summary.intervals_id, direct.activityFields(summary));
                if($h && summary.id === this.rideId) $h.textContent = '✓ Saved, and on intervals.icu';
            } catch(e) {
                if($h && summary.id === this.rideId) $h.textContent = `✓ Saved here; intervals.icu did not take it (${e.message})`;
            }
        }, 1000);
    }

    // ------------------------------------------------------------ uploads

    renderUploads() {
        for(const service of ['intervals']) {
            const $el = this.querySelector(`[data-up="${service}"]`);
            if(!$el) continue;
            const label = service === 'intervals' ? 'intervals.icu' : 'Strava';
            const state = this.uploading?.[service] ? 'loading' : (this.summary.status?.[service] ?? 'none');
            let note = '';
            let button = `Upload to ${label}`;
            if(state === 'loading') { button = 'Uploading…'; }
            else if(state === 'success') {
                button = `Re-upload to ${label}`;
                const link = service === 'intervals' && this.summary.intervals_id
                    ? ` · <a href="https://intervals.icu/activities/${esc(this.summary.intervals_id)}" target="_blank" rel="noopener">open</a>` : '';
                note = `<span class="ok">✓ On ${label}</span>${link}`;
            } else if(state === 'fail') { button = `Retry ${label}`; note = '<span class="bad">Upload failed</span>'; }
            $el.innerHTML = `<button type="button" ${state === 'loading' ? 'disabled' : ''}>${button}</button><span>${note}</span>`;
            $el.querySelector('button').onclick = () => this.upload(service);
        }
    }

    async upload(service) {
        await this.flush();
        const id = this.rideId;
        this.uploading = Object.assign(this.uploading ?? {}, {[service]: true});
        this.renderUploads();
        try {
            await models.activity.upload(service, id);
        } finally {
            this.uploading[service] = false;
            if(id === this.rideId) {
                const record = await models.activity.get(id);
                if(record) this.summary = record.summary;
                this.renderUploads();
            }
        }
    }
}

customElements.define('ride-summary', RideSummary);

export { RideSummary };
