//
// Paused, and impossible to miss (this fork, Nov 13, 2026, rider: "I want
// it to be very obvious if the workout is paused. Right now, it just shows
// the pause button is the play button. And you can sit there grinding for
// way too long").
//
// While the watch is paused: a pulsing amber frame round the whole screen,
// a big PAUSED banner over the charts (tap it to resume), and "⏸ Paused" at
// the front of the tab's title. Pedalling while paused turns it red and
// counts down to the automatic resume (watch.js).
//
// Under the banner, Resume and End workout (rider, Nov 13, 2026: "when you're
// paused any time, you should be able to click the end button"). End asks
// once, in place: a second tap within 4 s ends the ride, which saves it and
// opens the ride's end screen (ride-summary.js).
//
// Resuming a solo ride ramps back first (rider, Nov 26, 2026: "by default,
// it's 10 seconds of time to get you back, but it doesn't count towards your
// actual workout. And it shows it very clearly on screen"): the frame turns
// green, the banner counts down BACK IN 10…1 over "Ramping back to 240 W ·
// the clock waits", and Resume becomes Skip. watch.js holds the clock and
// power-match.js eases the trainer; this only shows it. A group ride resumes
// at once (doc/solo-and-group.md).
//

import { xf } from '../functions.js';

const style = `
pause-overlay { display: none; }
pause-overlay.on { display: block; }
pause-overlay .po--frame {
    position: fixed; inset: 0; z-index: 9990; pointer-events: none;
    box-shadow: inset 0 0 0 10px var(--po-colour, #f2a93b);
    animation: po-pulse 1.4s ease-in-out infinite;
}
pause-overlay .po--banner {
    position: fixed; z-index: 9991; left: 50%; top: 28%; transform: translate(-50%, -50%);
    min-width: min(560px, 80vw); padding: 0.5em 1.2em 0.6em; border-radius: 16px;
    background: var(--po-colour, #f2a93b); color: #16181d; text-align: center;
    font: 700 clamp(2.4rem, 6vw, 5.5rem)/1.05 system-ui, sans-serif; letter-spacing: 0.06em;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); cursor: pointer; user-select: none;
}
pause-overlay .po--sub {
    display: block; margin-top: 0.35em;
    font-size: clamp(0.9rem, 1.4vw, 1.4rem); font-weight: 600; letter-spacing: 0.01em;
}
pause-overlay .po--actions {
    position: fixed; z-index: 9991; left: 50%; top: calc(28% + clamp(5rem, 11vw, 9.5rem)); transform: translateX(-50%);
    display: flex; gap: 14px;
}
pause-overlay .po--actions button {
    font: 700 clamp(1rem, 1.6vw, 1.5rem) system-ui, sans-serif; padding: 0.6em 1.4em; border-radius: 12px;
    border: 2px solid var(--po-colour, #f2a93b); cursor: pointer; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
}
pause-overlay .po--resume { background: var(--po-colour, #f2a93b); color: #16181d; }
pause-overlay .po--end { background: #16181d; color: #fff; }
pause-overlay .po--end.confirm { background: #eb5757; border-color: #eb5757; }
pause-overlay.pedalling { --po-colour: #ff5a4f; }
pause-overlay.rampback { --po-colour: #3ecf8e; }
pause-overlay.rampback .po--frame { animation: none; }
@keyframes po-pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { pause-overlay .po--frame { animation: none; } }
`;

class PauseOverlay extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = { signal: this.abortController.signal };
        if(!document.getElementById('pause-overlay-style')) {
            const el = document.createElement('style');
            el.id = 'pause-overlay-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.innerHTML = `<div class="po--frame"></div>
            <div class="po--banner" role="button" aria-live="assertive"><span class="po--title">PAUSED</span><span class="po--sub"></span></div>
            <div class="po--actions">
                <button type="button" class="po--resume">▶ Resume</button>
                <button type="button" class="po--end">■ End workout</button>
            </div>`;
        this.$title = this.querySelector('.po--title');
        this.$sub = this.querySelector('.po--sub');
        this.$end = this.querySelector('.po--end');
        this.$resume = this.querySelector('.po--resume');
        this.$resume.addEventListener('click', () => this.onResume(), signal);
        this.$end.addEventListener('click', () => this.onEnd(), signal);
        this.baseTitle = document.title.replace(/^⏸ Paused — /, '');

        this.querySelector('.po--banner').addEventListener('pointerup', () => this.onResume(), signal);
        xf.sub('db:watchStatus', (s) => this.onStatus(s), signal);
        xf.sub('watch:resume-countdown', (n) => this.onCountdown(n), signal);
        xf.sub('watch:rampback', (r) => this.onRampback(r), signal);
        // the end of the workout has its own popup (workout-done.js)
        xf.sub('watch:done-prompt', (on) => { this.donePrompt = !!on; this.onStatus(this.status); }, signal);
        xf.sub('db:powerTarget', (w) => { this.target = w; this.drawRampback(); }, signal);
        this.onStatus('stopped');
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onResume() {
        if(this.rampback) {
            xf.dispatch('ui:rampback-skip');
            return;
        }
        xf.dispatch('ui:watchStart');
        xf.dispatch('ui:workoutStart');
    }
    onRampback(r) {
        this.rampback = (r && !r.done && r.left > 0) ? r : null;
        this.classList.toggle('rampback', !!this.rampback);
        if(this.rampback) {
            this.classList.remove('pedalling');
            this.$resume.textContent = 'Skip ▶';
            this.drawRampback();
        } else {
            this.$title.textContent = 'PAUSED';
            this.$resume.textContent = '▶ Resume';
            this.$sub.textContent = 'Tap here, press Space or ▶ to resume';
        }
    }
    drawRampback() {
        if(!this.rampback) return;
        const w = Math.round(this.target);
        this.$title.textContent = `BACK IN ${this.rampback.left}`;
        this.$sub.textContent = (w > 0 ? `Ramping back to ${w} W` : 'Ramping back') + ' · the clock waits';
    }
    onEnd() {
        if(this.$end.classList.contains('confirm')) {
            this.disarm();
            xf.dispatch('ui:watchEnd');
            return;
        }
        this.$end.classList.add('confirm');
        this.$end.textContent = 'Tap again to end';
        this.armTimer = setTimeout(() => this.disarm(), 4000);
    }
    disarm() {
        clearTimeout(this.armTimer);
        this.$end?.classList.remove('confirm');
        if(this.$end) this.$end.textContent = '■ End workout';
    }
    onStatus(status) {
        this.status = status;
        const paused = status === 'paused' && !this.donePrompt;
        if(!paused) { this.disarm(); this.onRampback(null); }
        this.classList.toggle('on', paused);
        if(!paused) this.onCountdown(null);
        else if(!this.classList.contains('pedalling') && !this.rampback) this.$sub.textContent = 'Tap here, press Space or ▶ to resume';
        document.title = paused ? `⏸ Paused — ${this.baseTitle}` : this.baseTitle;
    }
    onCountdown(n) {
        if(this.rampback) return;
        const pedalling = n !== null && n !== undefined;
        this.classList.toggle('pedalling', pedalling);
        this.$sub.textContent = pedalling
            ? (n > 0 ? `You're pedalling: resuming in ${n}…` : 'Resuming…')
            : 'Tap here, press Space or ▶ to resume';
    }
}

customElements.define('pause-overlay', PauseOverlay);
