//
// The spiral rescue, said on screen (rider, Nov 26, 2026: "When it saves
// you, it should say something on the screen like dropping power to help
// with spiral of death. Toggle this off in the settings if you want").
//
// power-match.js lets the trainer go when the cadence sinks under 40 rpm
// for 3 s and says so on powerMatch:rescue; this is a banner across the top
// of the ride screen while it lasts, then "Back to 248 W" for a moment.
// It never covers the controls and takes no clicks.
//
import { xf } from '../functions.js';

const style = `
spiral-rescue { position: fixed; z-index: 9989; left: 50%; top: 18px; transform: translateX(-50%);
    width: min(720px, calc(100vw - 32px)); pointer-events: none; display: none; }
spiral-rescue.on, spiral-rescue.done { display: block; }
spiral-rescue .sr--box { border-radius: 14px; padding: 14px 20px 15px; color: #16181d; background: #ff8a3d;
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45); font-family: system-ui, sans-serif; }
spiral-rescue.done .sr--box { background: #3ecf8e; }
spiral-rescue .sr--title { font-size: clamp(19px, 1.7vw, 26px); font-weight: 800; line-height: 1.2; }
spiral-rescue .sr--sub { margin-top: 5px; font-size: clamp(14px, 1.15vw, 17px); font-weight: 600; opacity: 0.85; line-height: 1.35; }
spiral-rescue .sr--sub b { font-variant-numeric: tabular-nums; }
`;

class SpiralRescue extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = { signal: this.abortController.signal };
        if(!document.getElementById('spiral-rescue-style')) {
            const el = document.createElement('style');
            el.id = 'spiral-rescue-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.setAttribute('role', 'status');
        this.setAttribute('aria-live', 'polite');
        this.innerHTML = `<div class="sr--box"><div class="sr--title"></div><div class="sr--sub"></div></div>`;
        this.$title = this.querySelector('.sr--title');
        this.$sub = this.querySelector('.sr--sub');
        xf.sub('powerMatch:rescue', (r) => this.onRescue(r), signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
        clearTimeout(this.doneTimer);
    }
    onRescue(r) {
        clearTimeout(this.doneTimer);
        const target = Math.round(r?.target ?? 0);
        if(r?.on) {
            this.classList.remove('done');
            this.classList.add('on');
            this.$title.textContent = 'Dropping power to get you out of the spiral';
            const cad = Math.round(r.cadence ?? 0);
            const watts = Math.round(r.watts ?? 0);
            this.$sub.innerHTML = `Cadence <b>${cad} rpm</b>${watts > 0 ? `, trainer at <b>${watts} W</b>` : ''}. Spin it up past 60 rpm and ${target > 0 ? `the <b>${target} W</b>` : 'the target'} comes back. `
                + `Turn this off in Settings → Spiral Rescue.`;
            return;
        }
        if(!this.classList.contains('on')) return;
        this.classList.remove('on');
        this.classList.add('done');
        this.$title.textContent = target > 0 ? `Back to ${target} W` : 'Back to the workout';
        this.$sub.textContent = 'Easing the trainer back up over 8 seconds.';
        this.doneTimer = setTimeout(() => this.classList.remove('done'), 3500);
    }
}

customElements.define('spiral-rescue', SpiralRescue);
