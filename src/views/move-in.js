//
// infERGno moved (rider, Nov 18, 2026: "bought infergno.com"): bring a
// browser's rides, settings and Strava connection over from where it used
// infERGno before (transfer.js, transfer-in.js).
//
// <move-in> on Home: shown to a browser the old address redirected here
// (?moved=, functions/_middleware.js) until it has brought its things over or
// said "Not now", and to the household until it has brought auuki's over.
// One button, because it opens a small window and browsers allow that only
// on a click. Afterwards it says what came over.
//
// <move-in mode="settings"> in Settings: every old address, always, with when
// each was last brought over.
//
import { xf } from '../functions.js';
import { FLAVOR } from '../flavor.js';
import { isHousehold } from '../household.js';
import { SOURCES } from '../transfer.js';
import { lastTransfer, transferAndReload, movedFrom, NOTICE } from '../transfer-in.js';

const style = `
move-in { display: block; }
move-in[hidden] { display: none; }
move-in .mi--card {
    padding: 0.8em 1em; border-radius: 0.8em; text-align: left; font-size: 0.95em; line-height: 1.4;
    background: rgba(242, 153, 74, 0.12); border: 1px solid rgba(242, 153, 74, 0.45);
}
move-in[mode="settings"] .mi--card { background: none; border: none; padding: 0; }
move-in .mi--title { font-weight: 700; margin-bottom: 0.3em; }
move-in .mi--row { display: flex; gap: 0.6em; flex-wrap: wrap; align-items: center; margin-top: 0.6em; }
move-in button {
    font: 600 0.95em system-ui, sans-serif; padding: 0.55em 0.95em; border-radius: 0.55em; cursor: pointer;
    color: inherit; background: var(--chrome, #2a2d34); border: 1px solid var(--border-color, #3a3d45);
}
move-in button.mi--go { background: #f2994a; color: #14161b; border-color: #f2994a; }
move-in .mi--note { opacity: 0.7; font-size: 0.9em; }
move-in .mi--ok { color: #6fdc9b; }
move-in .mi--bad { color: #ff8c8c; }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const host = (name) => SOURCES[name].origin.replace('https://', '');
const when = (ts) => new Date(ts).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
const DISMISSED = 'infergno:move:dismissed';
const brought = (name) => { const t = lastTransfer(name); return !!t && !t.error; };

// which old addresses the Home card offers now
export function offered({moved = movedFrom(), household = isHousehold(), done = brought, dismissed = []} = {}) {
    const out = [];
    if(moved && SOURCES[moved] && !done(moved) && !dismissed.includes(moved)) out.push(moved);
    if(household && !done('auuki') && !dismissed.includes('auuki')) out.push('auuki');
    return out;
}

class MoveIn extends HTMLElement {
    connectedCallback() {
        if(FLAVOR !== 'public') { this.hidden = true; if(this.getAttribute('mode') === 'settings') this.closest('.list--sub-section')?.remove(); return; }
        if(!document.getElementById('move-in-style')) {
            const el = document.createElement('style');
            el.id = 'move-in-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.settings = this.getAttribute('mode') === 'settings';
        this.msg = null;
        if(!this.settings) {
            try {
                const n = JSON.parse(sessionStorage.getItem(NOTICE) ?? 'null');
                if(n) {
                    sessionStorage.removeItem(NOTICE);
                    this.msg = ['ok', `Brought over from ${n.from}: ${n.settings} settings, ${n.rides} rides, ${n.workouts} workouts. Pair your Bluetooth devices once here.`];
                }
            } catch(e) {}
        }
        xf.sub('household:status', () => this.render());
        this.render();
    }
    dismissed() { try { return JSON.parse(localStorage.getItem(DISMISSED) ?? '[]'); } catch(e) { return []; } }
    render() {
        const msg = this.msg ? `<div class="mi--${this.msg[0]}">${esc(this.msg[1])}</div>` : '';
        const names = this.settings
            ? Object.keys(SOURCES).filter((n) => !SOURCES[n].household || isHousehold())
            : offered({dismissed: this.dismissed()});
        if(!names.length && !msg) { this.hidden = true; this.innerHTML = ''; return; }
        this.hidden = false;
        const status = (n) => { const t = lastTransfer(n); return t ? (t.error ? ` (last try failed: ${t.error})` : ` (brought over ${when(t.at)})`) : ''; };
        const buttons = names.map((n) => `<button type="button" class="${this.settings ? '' : 'mi--go'}" data-from="${n}">Bring over from ${esc(host(n))}</button>${this.settings ? `<span class="mi--note">${esc(status(n))}</span>` : ''}`).join(this.settings ? '</div><div class="mi--row">' : '');
        const intro = this.settings
            ? `<div class="mi--note">Rides, settings and your Strava connection from where you used this app before. It opens that address in a small window for a moment; allow pop-ups if asked. Bluetooth devices are paired again here.</div>`
            : names.length
                ? `<div class="mi--title">infERGno has moved here</div><div>Your rides, settings and Strava connection are still at ${names.map((n) => `<b>${esc(host(n))}</b>`).join(' and ')}. Bring them over: a small window opens for a moment.</div>`
                : '';
        this.innerHTML = `<div class="mi--card">${intro}${names.length ? `<div class="mi--row">${buttons}${this.settings ? '' : '<button type="button" data-act="later">Not now</button>'}</div>` : ''}${msg}</div>`;
        this.querySelectorAll('[data-from]').forEach((b) => b.addEventListener('click', async (e) => {
            const name = e.currentTarget.dataset.from;
            e.currentTarget.disabled = true;
            try { await transferAndReload(name); }
            catch(err) { this.msg = ['bad', `Not brought over: ${err.message}.`]; this.render(); }
        }));
        this.querySelector('[data-act="later"]')?.addEventListener('click', () => {
            try { localStorage.setItem(DISMISSED, JSON.stringify([...new Set([...this.dismissed(), ...names])])); } catch(e) {}
            this.render();
        });
    }
}

customElements.define('move-in', MoveIn);
export { MoveIn };
