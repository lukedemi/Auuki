//
// Reconnect, one click a device (rider, Nov 17, 2026: "when I load the page,
// each time, it's still not remembering my last paired devices").
//
// Chrome reconnects to a device it has paired before only through
// navigator.bluetooth.getDevices(), which on desktop Chrome sits behind
// chrome://flags/#enable-web-bluetooth-new-permissions-backend. With the
// flag on, the remembered devices come back by themselves on load
// (ble/reactive-connectable.js) and this strip never shows. Without it, a
// page may only open the Bluetooth picker on a click: so for each remembered
// device that is not connected a few seconds after load, a button opens the
// picker narrowed to that one device by name, and one Pair connects it. A
// button goes as its device connects; the strip goes when all have. Hidden
// while a ride is running.
//

import { xf } from '../functions.js';
import { remembered, reconnectOnLoad } from '../ble/reactive-connectable.js';

const LABEL = {
    'ble:controllable': 'Trainer',
    'ble:powerMeter': 'Power meter',
    'ble:heartRateMonitor': 'Heart rate',
    'ble:speedCadenceSensor': 'Speed / cadence',
};
const WAIT_MS = 4000;

const style = `
device-reconnect { display: none; }
device-reconnect.on {
    display: flex; position: fixed; z-index: 9980; top: 10px; left: 50%; transform: translateX(-50%);
    gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; width: max-content; max-width: 94vw;
    padding: 10px 14px; border-radius: 14px; background: #1f232b; border: 1px solid #3a3f4a;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); color: #eef0f4; font: 15px system-ui, sans-serif;
}
device-reconnect .dr--title { font-weight: 700; margin-right: 4px; }
device-reconnect button {
    font: 600 14px system-ui, sans-serif; padding: 8px 14px; border-radius: 10px; cursor: pointer;
    background: #2f80ed; border: 1px solid #2f80ed; color: #fff;
}
device-reconnect button small { opacity: 0.8; font-weight: 500; margin-left: 4px; }
device-reconnect .dr--close { background: transparent; border-color: #3a3f4a; color: #c4c8d0; }
device-reconnect .dr--hint { flex-basis: 100%; text-align: center; font-size: 12px; opacity: 0.6; }
`;

class DeviceReconnect extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = {signal: this.abortController.signal};
        if(!document.getElementById('device-reconnect-style')) {
            const el = document.createElement('style');
            el.id = 'device-reconnect-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.connected = new Set();
        this.dismissed = false;
        this.riding = false;
        for(const id of Object.keys(LABEL)) {
            xf.sub(`${id}:connected`, () => { this.connected.add(id); this.render(); }, signal);
            xf.sub(`${id}:disconnected`, () => { this.connected.delete(id); }, signal);
        }
        xf.sub('db:watchStatus', (s) => { this.riding = s === 'started'; this.render(); }, signal);
        this.ready = false;
        setTimeout(() => { this.ready = true; this.render(); }, WAIT_MS);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    missing() {
        const all = remembered();
        return Object.keys(LABEL).filter((id) => all[id]?.name && !this.connected.has(id)).map((id) => ({id, name: all[id].name}));
    }
    render() {
        const missing = this.ready && !this.dismissed && !this.riding && reconnectOnLoad() ? this.missing() : [];
        this.classList.toggle('on', missing.length > 0);
        if(!missing.length) { this.innerHTML = ''; return; }
        const auto = typeof navigator !== 'undefined' && typeof navigator.bluetooth?.getDevices === 'function';
        this.innerHTML = `<span class="dr--title">Reconnect</span>
            ${missing.map((d) => `<button type="button" data-id="${d.id}">${LABEL[d.id]}<small>${d.name}</small></button>`).join('')}
            <button type="button" class="dr--close" aria-label="Not now">Not now</button>
            ${auto ? '' : '<span class="dr--hint">For this to happen by itself: chrome://flags/#enable-web-bluetooth-new-permissions-backend → Enabled, then relaunch Chrome</span>'}`;
        this.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => xf.dispatch(`ui:${b.dataset.id}:reconnect`)));
        this.querySelector('.dr--close').addEventListener('click', () => { this.dismissed = true; this.render(); });
    }
}

customElements.define('device-reconnect', DeviceReconnect);

export { DeviceReconnect };
