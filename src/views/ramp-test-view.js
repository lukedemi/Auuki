//
// The ramp test's panel on the ride screen (ramp-test.js): while it climbs,
// the step, its target, the time to the next one, the best minute so far and
// the FTP it points to, and "I'm done"; at the end, the result, with a button
// to set FTP.
//
import { xf } from '../functions.js';

const style = `
ramp-test-view { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 60; font-family: system-ui, sans-serif; color: #e9eaee; }
ramp-test-view[hidden] { display: none; }
ramp-test-view .rt--live { display: flex; align-items: center; gap: 18px; padding: 10px 14px 10px 18px; border-radius: 14px;
    background: rgba(20,22,27,.92); border: 1px solid rgba(242,153,74,.55); box-shadow: 0 8px 30px rgba(0,0,0,.45); }
ramp-test-view .rt--k { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
ramp-test-view .rt--v { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
ramp-test-view .rt--v small { font-size: 13px; font-weight: 600; opacity: .7; }
ramp-test-view .rt--title { font-weight: 800; color: #f2994a; font-size: 14px; letter-spacing: .04em; }
ramp-test-view button { font: 700 14px system-ui, sans-serif; border-radius: 10px; padding: 10px 14px; cursor: pointer; border: 0; }
ramp-test-view .rt--done { background: rgba(255,255,255,.1); color: inherit; }
ramp-test-view .rt--card { width: min(520px, calc(100vw - 32px)); padding: 22px 24px; border-radius: 18px; background: rgba(20,22,27,.97);
    border: 1px solid rgba(242,153,74,.55); box-shadow: 0 12px 50px rgba(0,0,0,.55); text-align: left; }
ramp-test-view .rt--card h3 { margin: 8px 0 4px; font-size: 20px; line-height: 1.3; font-weight: 800; text-align: left; }
ramp-test-view .rt--nums { display: flex; gap: 26px; margin: 16px 0; }
ramp-test-view .rt--nums .rt--v { font-size: 30px; }
ramp-test-view .rt--note { font-size: 13.5px; line-height: 1.45; opacity: .72; margin: 0 0 16px; }
ramp-test-view .rt--row { display: flex; gap: 10px; flex-wrap: wrap; }
ramp-test-view .rt--set { background: #3fd08a; color: #0d1a12; }
ramp-test-view .rt--keep { background: rgba(255,255,255,.1); color: inherit; }
`;

const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const WHY = {failed: 'You couldn\'t hold the step any longer', stopped: 'You stopped pedalling', ended: 'You ended it', top: 'You rode off the top of the ramp'};

class RampTestView extends HTMLElement {
    connectedCallback() {
        if(!document.getElementById('ramp-test-style')) {
            const el = document.createElement('style');
            el.id = 'ramp-test-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.hidden = true;
        this.page = 'workouts';
        this.result = null;
        xf.sub('db:page', (p) => { this.page = p; this.paint(); });
        xf.sub('ramp-test:status', (s) => { this.status = s; this.paint(); });
        xf.sub('ramp-test:result', (r) => { this.result = r; this.paint(); });
        xf.sub('db:workout', () => { this.result = null; this.status = null; this.paint(); });
        this.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if(!b) return;
            if(b.dataset.act === 'end') xf.dispatch('ui:ramp-test:end');
            if(b.dataset.act === 'set') { xf.dispatch('ui:ramp-test:set-ftp', this.result.ftp); this.result = {...this.result, set: true}; this.paint(); }
            if(b.dataset.act === 'close') { this.result = null; this.paint(); }
        });
    }
    paint() {
        const r = this.result, s = this.status;
        if(r) {
            this.hidden = false;
            const change = r.current ? r.ftp - r.current : 0;
            this.innerHTML = r.best ? `<div class="rt--card">
                <div class="rt--title">RAMP TEST</div>
                <h3>${WHY[r.why] ?? 'Done'} after ${r.steps} steps.</h3>
                <div class="rt--note" style="margin:0">You're in the cool-down now; keep spinning easy.</div>
                <div class="rt--nums">
                    <div><div class="rt--k">Best minute</div><div class="rt--v">${r.best} <small>W</small></div></div>
                    <div><div class="rt--k">FTP (75%)</div><div class="rt--v" style="color:#3fd08a">${r.ftp} <small>W</small></div></div>
                    ${r.current ? `<div><div class="rt--k">Yours now</div><div class="rt--v">${r.current} <small>W · ${change >= 0 ? '+' : ''}${change}</small></div></div>` : ''}
                </div>
                <p class="rt--note">Ramp tests read high for riders with a big sprint; a 20-minute or lactate step test is the cross-check.${r.current ? ' If your FTP comes from intervals.icu, set it there too, or it comes back the next time the plan is fetched.' : ''}</p>
                <div class="rt--row">${r.set ? `<button type="button" class="rt--keep" data-act="close">FTP set to ${r.ftp} W ✓</button>`
                    : `<button type="button" class="rt--set" data-act="set">Set FTP to ${r.ftp} W</button><button type="button" class="rt--keep" data-act="close">Keep ${r.current || 'it'}${r.current ? ' W' : ''}</button>`}</div>
            </div>` : `<div class="rt--card"><div class="rt--title">RAMP TEST</div><h3>Too short to read.</h3>
                <p class="rt--note">It needs at least a minute on the ramp to find a best minute. Ride it again when you're ready.</p>
                <div class="rt--row"><button type="button" class="rt--keep" data-act="close">OK</button></div></div>`;
            return;
        }
        if(s?.state === 'ramping' && this.page === 'home') {
            this.hidden = false;
            this.innerHTML = `<div class="rt--live">
                <div class="rt--title">RAMP<br>TEST</div>
                <div><div class="rt--k">Step ${s.step}</div><div class="rt--v">${s.target} <small>W</small></div></div>
                <div><div class="rt--k">Next in</div><div class="rt--v">${mmss(s.nextIn)}</div></div>
                <div><div class="rt--k">Best min</div><div class="rt--v">${s.best || '–'} <small>${s.best ? 'W' : ''}</small></div></div>
                <div><div class="rt--k">FTP ≈</div><div class="rt--v" style="color:#3fd08a">${s.ftp || '–'} <small>${s.ftp ? 'W' : ''}</small></div></div>
                <button type="button" class="rt--done" data-act="end">I'm done</button>
            </div>`;
            return;
        }
        this.hidden = true;
        this.innerHTML = '';
    }
}

customElements.define('ramp-test-view', RampTestView);
if(typeof document !== 'undefined' && !document.querySelector('ramp-test-view')) document.body.appendChild(document.createElement('ramp-test-view'));
