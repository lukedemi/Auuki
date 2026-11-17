//
// After a ride ends, the home screen is closed until a new ride is started
// (rider, Nov 17, 2026: "When I click finish a workout, it should very
// clearly show that I finished a workout and show it somewhere. And end the
// home screen from being able to ride until I start again").
//
// When the ride is saved (or fails to save), this covers the home screen:
// "Workout complete", the ride just finished, and the completed rides kept in
// this browser, each opening its end screen (ride-summary.js, which opens on
// top of this). Underneath, the trainer is let go (ERG target 0), and the
// keys that would start or steer a ride do nothing. "Start a new ride" takes
// it away; nothing else does.
//

import { xf } from '../functions.js';

const style = `
ride-finished { display: none; }
ride-finished.on {
    display: flex; position: fixed; inset: 0; z-index: 9993; align-items: flex-start; justify-content: center;
    overflow-y: auto; background: rgba(10, 12, 16, 0.94); color: #eef0f4; font-family: system-ui, sans-serif;
}
ride-finished .rf--card { width: min(760px, 92vw); margin: 7vh 0; text-align: left; }
ride-finished .rf--done { font: 800 52px/1.05 system-ui, sans-serif; color: #6fdc9b; margin: 0; }
ride-finished .rf--sub { font-size: 20px; opacity: 0.75; margin: 10px 0 26px; }
ride-finished .rf--actions { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 34px; }
ride-finished button {
    font: 700 18px system-ui, sans-serif; padding: 12px 22px; border-radius: 12px; cursor: pointer;
    color: #eef0f4; background: #2a2d34; border: 1px solid #3a3d45;
}
ride-finished button.primary { background: #2f80ed; border-color: #2f80ed; color: #fff; }
ride-finished h3 { margin: 0 0 10px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; }
ride-finished .rf--list { display: grid; gap: 8px; }
ride-finished .rf--ride {
    display: grid; grid-template-columns: 1fr auto auto; gap: 16px; align-items: center; text-align: left;
    padding: 14px 16px; border-radius: 12px; background: #1b1e24; border: 1px solid #2c3038; font-weight: 500;
}
ride-finished .rf--ride.latest { border-color: #6fdc9b; }
ride-finished .rf--name { font-size: 17px; line-height: 1.3; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
ride-finished .rf--when { font-size: 14px; line-height: 1.4; opacity: 0.65; font-weight: 400; margin-top: 2px; }
ride-finished .rf--dur { font-variant-numeric: tabular-nums; opacity: 0.85; }
ride-finished .rf--icu { font-size: 14px; white-space: nowrap; }
ride-finished .rf--icu.ok { color: #6fdc9b; }
ride-finished .rf--icu.bad { color: #ff8c8c; }
ride-finished .rf--icu.none { opacity: 0.5; }
ride-finished .rf--warn { color: #ff8c8c; font-size: 18px; margin: 0 0 20px; }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const hmm = (s) => { const m = Math.round((s || 0) / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const when = (ts) => new Date(ts).toLocaleString([], {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
const ICU = {success: ['ok', '✓ intervals.icu'], fail: ['bad', 'upload failed'], loading: ['none', 'uploading…'], none: ['none', 'not uploaded']};

// keys that start, pause, lap or steer a ride (keyboard.js), held while closed
const BLOCKED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyL', 'KeyR', 'KeyS', 'KeyP', 'Equal', 'NumpadAdd']);

class RideFinished extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = {signal: this.abortController.signal};
        if(!document.getElementById('ride-finished-style')) {
            const el = document.createElement('style');
            el.id = 'ride-finished-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.rides = [];
        this.latest = null;
        this.failed = null;

        xf.sub('db:activity', (list) => { this.rides = Array.isArray(list) ? list.slice() : []; this.render(); }, signal);
        xf.sub('activity:add', (s) => {
            if(!s?.id) return;
            this.rides = [s, ...this.rides.filter((r) => r.id !== s.id)];
            this.latest = s.id;
            this.failed = null;
            this.show();
        }, signal);
        xf.sub('activity:save:fail', (msg) => { this.latest = null; this.failed = msg || 'the ride did not save'; this.show(); }, signal);
        xf.sub('activity:updated', (s) => {
            if(!s?.id) return;
            this.rides = this.rides.map((r) => (r.id === s.id ? Object.assign({}, r, s) : r));
            this.render();
        }, signal);
        xf.sub('activity:uploading', ({id, service} = {}) => {
            if(service !== 'intervals') return;
            this.rides = this.rides.map((r) => (r.id === id ? Object.assign({}, r, {status: Object.assign({}, r.status, {intervals: 'loading'})}) : r));
            this.render();
        }, signal);

        // closed means closed: no key reaches the ride underneath
        window.addEventListener('keydown', (e) => {
            if(!this.classList.contains('on')) return;
            if(document.querySelector('ride-summary.open')) return;   // its own fields and Escape
            if(BLOCKED.has(e.code)) { e.stopImmediatePropagation(); e.preventDefault(); }
        }, Object.assign({capture: true}, signal));
    }
    disconnectedCallback() {
        this.abortController.abort();
    }

    show() {
        this.classList.add('on');
        this.render();
        // the trainer let go; after the watch's own reset to the first step, which sets a target
        setTimeout(() => xf.dispatch('ui:power-target-set', 0), 0);
        setTimeout(() => xf.dispatch('ui:power-target-set', 0), 1500);
    }

    hide() {
        this.classList.remove('on');
        this.latest = null;
        this.failed = null;
    }

    render() {
        if(!this.classList.contains('on')) return;
        const latest = this.rides.find((r) => r.id === this.latest);
        const rows = this.rides.slice(0, 7).map((r) => {
            const [cls, text] = ICU[r.status?.intervals ?? 'none'] ?? ICU.none;
            return `<button type="button" class="rf--ride ${r.id === this.latest ? 'latest' : ''}" data-id="${esc(r.id)}">
                <span><div class="rf--name">${esc(r.name)}</div><div class="rf--when">${esc(when(r.timestamp))}</div></span>
                <span class="rf--dur">${hmm(r.duration)}</span>
                <span class="rf--icu ${cls}">${text}</span>
            </button>`;
        }).join('');
        this.innerHTML = `<div class="rf--card">
            <h1 class="rf--done">✓ Workout complete</h1>
            <p class="rf--sub">${latest ? `${esc(latest.name)} · ${hmm(latest.duration)}.` : 'The ride has ended.'} The trainer is released; nothing records until you start a new ride.</p>
            ${this.failed ? `<p class="rf--warn">${esc(this.failed)}. The .fit was downloaded, and the ride comes back when the page reloads.</p>` : ''}
            <div class="rf--actions">
                ${latest ? `<button type="button" class="primary" data-act="view">View this ride</button>` : ''}
                <button type="button" data-act="new">Start a new ride</button>
            </div>
            <h3>Completed rides</h3>
            <div class="rf--list">${rows || '<p style="opacity:0.6">None saved in this browser yet.</p>'}</div>
        </div>`;
        this.querySelector('[data-act="view"]')?.addEventListener('click', () => xf.dispatch('ui:ride-summary:open', this.latest));
        this.querySelector('[data-act="new"]').addEventListener('click', () => this.hide());
        this.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => xf.dispatch('ui:ride-summary:open', b.dataset.id)));
    }
}

customElements.define('ride-finished', RideFinished);

export { RideFinished };
