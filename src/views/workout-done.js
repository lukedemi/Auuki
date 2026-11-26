//
// The end of a solo workout (rider, Nov 26, 2026: "When I'm done the
// workout, it should say, congratulations, and pop up. You should be able to
// click, no, I want to do more or something like that").
//
// watch.js stops the clock on the workout's last second and says
// watch:done-prompt; this asks what next:
//   Finish & save  — the ride ends there (ui:watchEnd): saved, end screen
//   Keep riding    — the clock starts again, a free ride (ui:keep-riding)
// ▶ and Space also keep riding; Stop also finishes.
//
import { xf } from '../functions.js';

const style = `
workout-done { position: fixed; inset: 0; z-index: 9995; display: none; align-items: center; justify-content: center;
    background: rgba(10, 12, 16, 0.6); backdrop-filter: blur(3px); font-family: system-ui, sans-serif; }
workout-done.on { display: flex; }
workout-done .wd--card { width: min(520px, calc(100vw - 32px)); border-radius: 18px; padding: 30px 30px 26px; text-align: center;
    background: var(--background-color-2, #23252b); color: var(--foreground-color, #fff); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.08); }
workout-done .wd--party { font-size: 46px; line-height: 1.1; }
workout-done h2 { margin: 14px 0 6px; font-size: 30px; line-height: 1.2; font-weight: 800; letter-spacing: -0.01em; }
workout-done .wd--name { font-size: 17px; line-height: 1.35; opacity: 0.75; }
workout-done .wd--time { margin: 16px 0 24px; font-size: 14px; line-height: 1.3; color: rgba(255, 255, 255, 0.6); font-variant-numeric: tabular-nums; }
workout-done .wd--time b { font-size: 28px; line-height: 1.2; display: block; margin-bottom: 2px; color: var(--foreground-color, #fff); }
workout-done .wd--actions { display: grid; gap: 10px; }
workout-done button { font: 700 18px system-ui, sans-serif; padding: 15px 18px; border-radius: 12px; cursor: pointer; border: 0; }
workout-done .wd--finish { background: #3fd08a; color: #0d1a12; }
workout-done .wd--finish:hover { filter: brightness(1.06); }
workout-done .wd--more { background: transparent; color: inherit; border: 1px solid rgba(255, 255, 255, 0.18); font-weight: 600; font-size: 16px; }
workout-done .wd--more small { display: block; font-weight: 400; font-size: 13px; line-height: 1.35; opacity: 0.6; margin-top: 4px; }
`;

const hms = (s) => {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

class WorkoutDone extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = { signal: this.abortController.signal };
        if(!document.getElementById('workout-done-style')) {
            const el = document.createElement('style');
            el.id = 'workout-done-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.setAttribute('role', 'dialog');
        this.setAttribute('aria-modal', 'true');
        this.setAttribute('aria-labelledby', 'wd-title');
        this.innerHTML = `<div class="wd--card">
            <div class="wd--party">🎉</div>
            <h2 id="wd-title">Workout complete</h2>
            <div class="wd--name"></div>
            <div class="wd--time"><b></b>ride time</div>
            <div class="wd--actions">
                <button type="button" class="wd--finish">Finish &amp; save</button>
                <button type="button" class="wd--more">Keep riding<small>No, I want to do more: the clock starts again as a free ride</small></button>
            </div></div>`;
        this.$name = this.querySelector('.wd--name');
        this.$time = this.querySelector('.wd--time b');
        this.querySelector('.wd--finish').addEventListener('click', () => xf.dispatch('ui:watchEnd'), signal);
        this.querySelector('.wd--more').addEventListener('click', () => xf.dispatch('ui:keep-riding'), signal);
        xf.sub('db:workout', (w) => { this.name = w?.meta?.name ?? ''; }, signal);
        xf.sub('watch:elapsed', (t) => { this.elapsed = t; }, signal);
        xf.sub('watch:done-prompt', (on) => this.show(!!on), signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    show(on) {
        this.classList.toggle('on', on);
        if(!on) return;
        this.$name.textContent = this.name || '';
        this.$time.textContent = hms(this.elapsed);
        this.querySelector('.wd--finish').focus();
    }
}

customElements.define('workout-done', WorkoutDone);
