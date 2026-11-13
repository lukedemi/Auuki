//
// "Ride restored" — shown for a few seconds after a reload brings back a
// ride in progress (models.js Session keeps it in IndexedDB as it goes).
//

import { xf } from '../functions.js';
import { formatTime } from '../utils.js';

class SessionNotice extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        this.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9998;display:none;' +
            'max-width:calc(100vw - 32px);padding:10px 16px;border-radius:8px;background:#1f6f43;color:#fff;' +
            'font:15px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);cursor:pointer';
        this.addEventListener('pointerup', () => this.hide(), {signal: this.abortController.signal});
        xf.sub('session:restored', this.onRestored.bind(this), {signal: this.abortController.signal});
    }
    disconnectedCallback() {
        this.abortController.abort();
        clearTimeout(this.timer);
    }
    onRestored({elapsed = 0} = {}) {
        if(!(elapsed > 0)) return;
        const time = formatTime({value: elapsed, format: 'hh:mm:ss', unit: 'seconds'});
        this.textContent = `Ride restored — ${time} recorded. Pedal or press ▶ to carry on.`;
        this.style.display = 'block';
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.hide(), 20000);
    }
    hide() {
        this.style.display = 'none';
    }
}

customElements.define('session-notice', SessionNotice);
