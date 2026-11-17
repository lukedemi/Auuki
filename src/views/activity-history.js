//
// Workouts > Activities: every ride saved in this browser, newest first
// (rider, Nov 17, 2026: "I think activities should be a top level tab, like
// workouts, ride report, and editor. That way you can click in to see what
// you've done"). Each row is the ride's name, when, how long, its RPE and
// feel if set, and whether it is on intervals.icu; clicking it opens the
// ride's end screen (ride-summary.js), where its image, notes, upload,
// download and delete live.
//
// This replaced upstream's Activities list under Workouts > Workouts.
//

import { xf } from '../functions.js';

const style = `
activity-history .ah--wrap { max-width: 900px; margin: 0 auto; padding: 18px 16px 40px; }
activity-history .ah--head { display: flex; align-items: baseline; gap: 12px; margin: 0 0 14px; }
activity-history .ah--head h2 { margin: 0; font-size: 22px; }
activity-history .ah--head span { opacity: 0.6; font-size: 14px; }
activity-history .ah--list { display: grid; gap: 8px; }
activity-history .ah--ride {
    display: grid; grid-template-columns: 1fr auto auto auto; gap: 18px; align-items: center; width: 100%;
    padding: 14px 16px; border-radius: 12px; text-align: left; cursor: pointer;
    color: inherit; background: var(--background-color-2, #1b1e24); border: 1px solid var(--border-color, #2c3038);
    font: inherit;
}
activity-history .ah--ride:hover { filter: brightness(1.15); }
activity-history .ah--name { font-size: 17px; line-height: 1.3; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
activity-history .ah--when { font-size: 14px; line-height: 1.4; opacity: 0.65; margin-top: 2px; }
activity-history .ah--dur { font-variant-numeric: tabular-nums; font-size: 16px; }
activity-history .ah--felt { font-size: 14px; opacity: 0.8; white-space: nowrap; }
activity-history .ah--icu { font-size: 14px; white-space: nowrap; }
activity-history .ah--icu.ok { color: #6fdc9b; }
activity-history .ah--icu.bad { color: #ff8c8c; }
activity-history .ah--icu.none { opacity: 0.55; }
activity-history .ah--strava { color: #FC5200; font-weight: 600; margin-left: 6px; }
activity-history .ah--empty { opacity: 0.6; padding: 20px 0; }
@media (max-width: 640px) {
    activity-history .ah--ride { grid-template-columns: 1fr auto; }
    activity-history .ah--felt { display: none; }
}
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const hmm = (s) => { const m = Math.round((s || 0) / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const when = (ts) => new Date(ts).toLocaleString([], {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
const FEEL = {1: 'very strong', 2: 'strong', 3: 'normal', 4: 'meh', 5: 'weak'};
const ICU = {success: ['ok', '✓ intervals.icu'], fail: ['bad', 'upload failed'], loading: ['none', 'uploading…'], none: ['none', 'not uploaded']};

export function rowHtml(r) {
    const [cls, text] = ICU[r.status?.intervals ?? 'none'] ?? ICU.none;
    const felt = [r.rpe ? `RPE ${r.rpe}` : '', r.feel ? FEEL[r.feel] : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="ah--ride" data-id="${esc(r.id)}">
        <span><div class="ah--name">${esc(r.name)}</div><div class="ah--when">${esc(when(r.timestamp))}</div></span>
        <span class="ah--felt">${esc(felt)}</span>
        <span class="ah--dur">${hmm(r.duration)}</span>
        <span class="ah--icu ${cls}">${text}${r.status?.strava === 'success' ? ' <span class="ah--strava">✓ Strava</span>' : r.status?.strava === 'loading' ? ' <span class="ah--strava">Strava…</span>' : ''}</span>
    </button>`;
}

class ActivityHistory extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = {signal: this.abortController.signal};
        if(!document.getElementById('activity-history-style')) {
            const el = document.createElement('style');
            el.id = 'activity-history-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.rides = [];
        const merge = (s) => { this.rides = this.rides.map((r) => (r.id === s.id ? Object.assign({}, r, s) : r)); };
        xf.sub('db:activity', (list) => { this.rides = Array.isArray(list) ? list.slice() : []; this.render(); }, signal);
        xf.sub('activity:add', (s) => { if(s?.id) { this.rides = [s, ...this.rides.filter((r) => r.id !== s.id)]; this.render(); } }, signal);
        xf.sub('activity:updated', (s) => { if(s?.id) { merge(s); this.render(); } }, signal);
        xf.sub('activity:deleted', (id) => { this.rides = this.rides.filter((r) => r.id !== id); this.render(); }, signal);
        xf.sub('activity:uploading', ({id, service} = {}) => {
            if(service !== 'intervals' && service !== 'strava') return;
            const r = this.rides.find((x) => x.id === id);
            if(r) { merge({id, status: Object.assign({}, r.status, {[service]: 'loading'})}); this.render(); }
        }, signal);
        this.addEventListener('click', (e) => {
            const id = e.target.closest?.('[data-id]')?.dataset.id;
            if(id) xf.dispatch('ui:ride-summary:open', id);
        }, signal);
        this.render();
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    render() {
        const rides = this.rides.slice().sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
        this.innerHTML = `<div class="ah--wrap">
            <div class="ah--head"><h2>Activities</h2><span>${rides.length ? `${rides.length} saved in this browser` : ''}</span></div>
            <div class="ah--list">${rides.length ? rides.map(rowHtml).join('') : '<p class="ah--empty">No rides saved in this browser yet. A ride is saved the moment it ends.</p>'}</div>
        </div>`;
    }
}

customElements.define('activity-history', ActivityHistory);

export { ActivityHistory };
