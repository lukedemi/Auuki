//
// The trainer room, over the live chart (room.js): temperature, humidity,
// CO2 and the two fans. CO2 turns amber at 1,000 ppm and red at 1,400.
// Hidden when Home Assistant has nothing to say (away from home, HA down).
//

import { xf } from '../functions.js';
import room from '../room.js';

const style = `
room-status {
    position: absolute; z-index: 2; top: 0.45em; left: 50%; transform: translateX(-50%);
    display: none; gap: 1.1em; align-items: center; white-space: nowrap;
    font-size: 14px; font-variant-numeric: tabular-nums; color: var(--foreground-color, #eee);
    pointer-events: none;
}
room-status.on { display: flex; }
room-status .rm--v { opacity: 0.85; }
room-status .rm--v b { font-weight: 700; }
room-status .rm--label { opacity: 0.55; margin-right: 0.3em; }
room-status .rm--co2.warn b { color: #f2c94c; }
room-status .rm--co2.high b { color: #ff6b6b; }
room-status .rm--fan.spin b { color: #6fb7ff; }
@media (max-width: 900px) { room-status { display: none !important; } }
`;

export function co2Level(ppm) {
    if(typeof ppm !== 'number') return '';
    return ppm >= 1400 ? 'high' : ppm >= 1000 ? 'warn' : '';
}

export function fansText(fans = {}) {
    const f = fans.front, r = fans.rear;
    if(!f && !r) return null;
    const on = [f?.on && 'front', r?.on && 'rear'].filter(Boolean);
    const w = (f?.on ? f.w ?? 0 : 0) + (r?.on ? r.w ?? 0 : 0);
    if(!on.length) return {text: 'off', spin: false};
    const which = on.length === 2 ? 'both' : on[0];
    return {text: `${which}${w ? ` · ${w} W` : ''}`, spin: true};
}

class RoomStatus extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        if(!document.getElementById('room-status-style')) {
            const el = document.createElement('style');
            el.id = 'room-status-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        xf.sub('room:update', (r) => this.render(r), {signal: this.abortController.signal});
        this.render(room.latest());
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    render(r) {
        const has = r && (r.temp_f != null || r.co2 != null);
        this.classList.toggle('on', !!has);
        if(!has) { this.innerHTML = ''; return; }
        const parts = [];
        if(r.temp_f != null) parts.push(`<span class="rm--v"><span class="rm--label">Room</span><b>${r.temp_f.toFixed(1)}°F</b></span>`);
        if(r.humidity != null) parts.push(`<span class="rm--v"><b>${Math.round(r.humidity)}%</b></span>`);
        if(r.co2 != null) parts.push(`<span class="rm--v rm--co2 ${co2Level(r.co2)}"><span class="rm--label">CO₂</span><b>${Math.round(r.co2)}</b> ppm</span>`);
        const fans = fansText(r.fans);
        if(fans) parts.push(`<span class="rm--v rm--fan ${fans.spin ? 'spin' : ''}"><span class="rm--label">Fans</span><b>${fans.text}</b></span>`);
        this.innerHTML = parts.join('');
    }
}

customElements.define('room-status', RoomStatus);

export { RoomStatus };
