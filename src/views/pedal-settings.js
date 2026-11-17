//
// Settings > Power Meter: the pedals' crank length and zero (rider, Nov 17,
// 2026: "It would be nice to at least be able to see what … crank length
// the power pedals are set to … or even better, be able to actually
// adjust"). Read from the pedals on every connect and set on them over the
// Bluetooth control point (ble/cps/cps.js), so what is shown is what the
// pedals hold, not a number kept here. A pedal computes power from the force
// on it times this length, so a wrong one is a wrong reading in proportion
// (172.5 set on 145 mm cranks reads 19 % high).
//
// Zero (offset compensation) is the calibration done unloaded: cranks level,
// feet off.
//

import { xf } from '../functions.js';

export const CRANKS = Array.from({length: (200 - 110) / 2.5 + 1}, (_, i) => 110 + i * 2.5);
const fmt = (mm) => (Number.isInteger(mm) ? `${mm}` : mm.toFixed(1));

const style = `
pedal-settings { display: block; padding: 10px 14px 14px; border-top: 1px solid var(--border-color, #333); font-size: 15px; }
pedal-settings .ps--row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 6px 0; }
pedal-settings .ps--label { min-width: 110px; opacity: 0.7; }
pedal-settings .ps--value { font-weight: 700; font-size: 18px; min-width: 90px; }
pedal-settings select, pedal-settings button {
    font: 600 14px system-ui, sans-serif; padding: 6px 12px; border-radius: 8px; cursor: pointer;
    color: inherit; background: var(--chrome, #2a2d34); border: 1px solid var(--border-color, #3a3d45);
}
pedal-settings button:disabled, pedal-settings select:disabled { opacity: 0.5; cursor: default; }
pedal-settings .ps--note { opacity: 0.65; font-size: 13px; }
pedal-settings .ps--msg.ok { color: #6fdc9b; }
pedal-settings .ps--msg.bad { color: #ff8c8c; }
`;

class PedalSettings extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = {signal: this.abortController.signal};
        if(!document.getElementById('pedal-settings-style')) {
            const el = document.createElement('style');
            el.id = 'pedal-settings-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.caps = null;
        this.crank = null;
        this.msg = null;
        this.zeroing = false;
        xf.sub('pedals:caps', (c) => { this.caps = c; if(!c) { this.crank = null; this.msg = null; } this.render(); }, signal);
        xf.sub('pedals:crank', (r = {}) => {
            if(r.mm) this.crank = r.mm;
            this.msg = r.error ? ['bad', `Crank length: ${r.error}`] : (r.set ? ['ok', `Set to ${fmt(r.mm)} mm on the pedals.`] : this.msg);
            this.render();
        }, signal);
        xf.sub('pedals:zero', (r = {}) => {
            this.zeroing = !!r.busy;
            if(r.ok) this.msg = ['ok', `Zeroed${r.offset !== null && r.offset !== undefined ? ` (offset ${r.offset})` : ''}.`];
            if(r.error) this.msg = ['bad', `Zero: ${r.error}`];
            this.render();
        }, signal);
        this.render();
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    render() {
        const c = this.caps;
        if(!c) {
            this.innerHTML = `<div class="ps--row"><span class="ps--label">Crank length</span><span class="ps--note">connect the pedals to read it</span></div>`;
            return;
        }
        const options = CRANKS.map((mm) => `<option value="${mm}" ${mm === (this.pick ?? this.crank ?? 172.5) ? 'selected' : ''}>${fmt(mm)} mm</option>`).join('');
        this.innerHTML = `
            <div class="ps--row">
                <span class="ps--label">Crank length</span>
                <span class="ps--value">${this.crank ? `${fmt(this.crank)} mm` : '—'}</span>
                ${c.crankLength ? `<select aria-label="Crank length">${options}</select><button type="button" data-act="set">Set on pedals</button><button type="button" data-act="read">Read again</button>`
                    : `<span class="ps--note">these pedals don't share it over Bluetooth: use the Favero app</span>`}
            </div>
            <div class="ps--row">
                <span class="ps--label">Zero</span>
                ${c.zero ? `<button type="button" data-act="zero" ${this.zeroing ? 'disabled' : ''}>${this.zeroing ? 'Zeroing…' : 'Zero the pedals'}</button><span class="ps--note">cranks level, feet off the pedals</span>`
                    : `<span class="ps--note">not offered over Bluetooth: use the Favero app</span>`}
            </div>
            ${this.msg ? `<div class="ps--row ps--msg ${this.msg[0]}">${this.msg[1]}</div>` : ''}`;
        const $sel = this.querySelector('select');
        $sel?.addEventListener('change', () => { this.pick = Number($sel.value); });
        this.querySelector('[data-act="set"]')?.addEventListener('click', () => {
            const mm = Number($sel.value);
            this.msg = null;
            xf.dispatch('ui:pedals:crank:set', mm);
        });
        this.querySelector('[data-act="read"]')?.addEventListener('click', () => xf.dispatch('ui:pedals:read'));
        this.querySelector('[data-act="zero"]')?.addEventListener('click', () => { this.msg = null; xf.dispatch('ui:pedals:zero'); });
    }
}

customElements.define('pedal-settings', PedalSettings);

export { PedalSettings };
