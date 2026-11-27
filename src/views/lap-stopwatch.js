//
// The lap stopwatch's pill, top centre of the live chart (stopwatch.js has
// the why). L starts it or starts a new lap; a click puts it away.
//
import { xf } from '../functions.js';
import { idle, press, seconds, clock } from '../stopwatch.js';

const style = `
lap-stopwatch { position: absolute; z-index: 5; top: 0.3em; left: 50%; transform: translateX(-50%);
    display: none; align-items: baseline; gap: 0.55em; padding: 0.2em 0.85em 0.25em; border-radius: 999px;
    background: var(--chrome, #3a3d45); border: 1px solid var(--border-color, #555); color: var(--foreground-color, #eee);
    font-family: system-ui, sans-serif; cursor: pointer; user-select: none; white-space: nowrap;
    font-variant-numeric: tabular-nums; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3); }
lap-stopwatch.on { display: inline-flex; }
lap-stopwatch .sw--label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; opacity: 0.6; }
lap-stopwatch .sw--time { font-size: 24px; font-weight: 800; line-height: 1.1; }
lap-stopwatch .sw--last { font-size: 13px; font-weight: 600; opacity: 0.6; }
lap-stopwatch .sw--last:empty { display: none; }
lap-stopwatch.flash { animation: sw-flash 0.6s ease-out; }
@keyframes sw-flash { from { background: #3ecf8e; color: #16181d; } }
/* a phone's chart header is full (zoom buttons, avg): sit just under it */
@media (max-width: 600px) { lap-stopwatch { top: 2.3em; } lap-stopwatch .sw--time { font-size: 17px; } }
`;

class LapStopwatch extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = { signal: this.abortController.signal };
        if(!document.getElementById('lap-stopwatch-style')) {
            const el = document.createElement('style');
            el.id = 'lap-stopwatch-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.state = idle();
        this.elapsed = 0;
        this.setAttribute('role', 'timer');
        this.title = 'Lap stopwatch: L starts a new lap, click to put it away';
        this.innerHTML = `<span class="sw--label">LAP</span><span class="sw--time">0:00</span><span class="sw--last"></span>`;
        this.$label = this.querySelector('.sw--label');
        this.$time = this.querySelector('.sw--time');
        this.$last = this.querySelector('.sw--last');
        xf.sub('ui:stopwatch', () => this.onPress(), signal);
        xf.sub('db:elapsed', (t) => { this.elapsed = t ?? 0; this.render(); }, signal);
        xf.sub('db:watchStatus', (s) => { if(s === 'stopped') this.clear(); }, signal);
        this.addEventListener('click', () => this.clear(), signal);
    }
    disconnectedCallback() { this.abortController.abort(); }
    onPress() {
        this.state = press(this.state, this.elapsed);
        xf.dispatch('stopwatch:lap', {n: this.state.n, last: this.state.last});
        this.classList.add('on');
        this.classList.remove('flash');
        void this.offsetWidth;   // restart the flash on every press
        this.classList.add('flash');
        this.render();
    }
    clear() {
        this.state = idle();
        this.classList.remove('on', 'flash');
    }
    render() {
        const s = seconds(this.state, this.elapsed);
        if(s === null) return;
        this.$label.textContent = this.state.n > 1 ? `LAP ${this.state.n}` : 'LAP';
        this.$time.textContent = clock(s);
        this.$last.textContent = this.state.last === null ? '' : `last ${clock(this.state.last)}`;
    }
}

customElements.define('lap-stopwatch', LapStopwatch);
