//
// Power Match debug panel
//
// Shown when Settings > Power Match Debug is on, or the URL carries ?debug.
// A small fixed overlay: what both devices read, the learned ratio, the
// workout target against what the trainer was actually sent, plus the log
// download and the no-hardware simulation (see power-match.js).
//

import { xf, exists, } from '../functions.js';
import powerMatch from '../power-match.js';

const style = `
power-match-debug {
    position: fixed;
    left: 8px;
    bottom: 104px;
    z-index: 9999;
    display: none;
    width: min(340px, calc(100vw - 16px));
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 6px;
    background: rgba(10, 10, 12, 0.88);
    color: #e8e8e8;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
    user-select: text;
}
power-match-debug.on { display: block; }
power-match-debug.min .pmd--body { display: none; }
power-match-debug .pmd--head {
    display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
}
power-match-debug .pmd--title { font-weight: bold; flex: 1; letter-spacing: 0.05em; }
power-match-debug button {
    font: inherit; color: inherit; background: #2a2a30; border: 1px solid #444;
    border-radius: 4px; padding: 1px 6px; cursor: pointer;
}
power-match-debug button.active { background: #7a4d00; border-color: #c78000; }
power-match-debug .pmd--grid {
    display: grid; grid-template-columns: auto 1fr auto 1fr; column-gap: 8px;
}
power-match-debug .pmd--k { color: #9a9aa2; }
power-match-debug .pmd--v { text-align: right; font-variant-numeric: tabular-nums; }
power-match-debug .pmd--row { display: flex; gap: 6px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
power-match-debug input {
    font: inherit; width: 5em; color: inherit; background: #1b1b1f;
    border: 1px solid #444; border-radius: 4px; padding: 1px 4px;
}
power-match-debug .pmd--foot { margin-top: 6px; color: #7a7a82; }
power-match-debug .ok   { color: #7bd88f; }
power-match-debug .warn { color: #f2c35b; }
power-match-debug .bad  { color: #ff7a7a; }
`;

function n(value, digits = 0) {
    if(!exists(value) || Number.isNaN(value)) return '--';
    return Number(value).toFixed(digits);
}

function pct(ratio) {
    if(!exists(ratio)) return '--';
    const p = (ratio - 1) * 100;
    return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

function ago(t, now) {
    if(!exists(t)) return '--';
    const s = Math.max(0, Math.round((now - t) / 1000));
    return `${s}s`;
}

class PowerMatchDebug extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = { signal: this.abortController.signal };

        if(!document.getElementById('power-match-debug-style')) {
            const el = document.createElement('style');
            el.id = 'power-match-debug-style';
            el.textContent = style;
            document.head.appendChild(el);
        }

        this.forced  = new URL(document.location).searchParams.has('debug');
        this.setting = false;
        this.row     = powerMatch.snapshot();
        this.lastSend;
        this.version = '';

        this.innerHTML = `
            <div class="pmd--head">
                <span class="pmd--title">POWER MATCH</span>
                <button data-act="sim">sim</button>
                <button data-act="csv">csv</button>
                <button data-act="clear">clear</button>
                <button data-act="mark" title="Put a mark in the debug trace">mark</button>
                <button data-act="min">_</button>
            </div>
            <div class="pmd--body">
                <div class="pmd--grid"></div>
                <div class="pmd--row">
                    <span class="pmd--k">sim meter/trainer</span>
                    <input data-in="offset" type="number" step="0.01" min="0.8" max="1.2" value="1.03">
                </div>
                <div class="pmd--foot"></div>
            </div>
        `;
        this.$grid   = this.querySelector('.pmd--grid');
        this.$foot   = this.querySelector('.pmd--foot');
        this.$sim    = this.querySelector('[data-act="sim"]');
        this.$offset = this.querySelector('[data-in="offset"]');

        this.addEventListener('click', this.onClick.bind(this), signal);
        this.$offset.addEventListener('change', this.onOffset.bind(this), signal);

        xf.sub('db:sources', this.onSources.bind(this), signal);
        xf.sub('powerMatch:debug', this.onRow.bind(this), signal);

        // re-render once a second so the ages tick even with no data
        this.timer = setInterval(() => this.render(), 1000);

        fetch('./version.json', {cache: 'no-store'})
            .then(r => r.ok ? r.json() : {})
            .then(v => {
                this.version = [v.sha, v.built].filter(Boolean).join(' · ');
                this.render();
            })
            .catch(() => {});

        this.show();
        this.render();
    }

    disconnectedCallback() {
        this.abortController.abort();
        clearInterval(this.timer);
    }

    onSources(sources = {}) {
        this.setting = sources.powerMatchDebug ?? false;
        this.show();
    }

    show() {
        this.classList.toggle('on', this.forced || this.setting);
    }

    onRow(row) {
        this.row = row;
        if(['send', 'correct', 'target', 'enable', 'disable', 'sim:start', 'sim:stop',
            'meter:disconnect', 'trainer:disconnect'].includes(row.event)) {
            this.lastSend = row.t;
        }
        this.render();
    }

    onClick(e) {
        const act = e.target?.dataset?.act;
        if(!act) return;
        if(act === 'sim') {
            powerMatch.simulate(!powerMatch.isSimulating(), {offset: this.$offset.value});
        }
        if(act === 'csv')   powerMatch.download();
        if(act === 'clear') powerMatch.clear();
        if(act === 'mark')  { window.trace?.mark('marked from the power match panel'); e.target.textContent = 'marked'; setTimeout(() => e.target.textContent = 'mark', 1500); }
        if(act === 'min')   this.classList.toggle('min');
        this.render();
    }

    onOffset() {
        if(powerMatch.isSimulating()) {
            powerMatch.simulate(true, {offset: this.$offset.value});
        }
    }

    render() {
        if(!this.classList.contains('on')) return;
        const r   = this.row ?? {};
        const now = Date.now();
        const sim = powerMatch.isSimulating();

        this.$sim.classList.toggle('active', sim);

        const state = !r.enabled ? '<span class="warn">off</span>'
              : !r.ready ? '<span class="warn">learning</span>'
              : '<span class="ok">matching</span>';
        const meterErr = (exists(r.meter) && r.target > 0)
              ? r.meter - r.target : undefined;
        const errClass = !exists(meterErr) ? '' :
              Math.abs(meterErr) <= 5 ? 'ok' : Math.abs(meterErr) <= 15 ? 'warn' : 'bad';

        const cells = [
            ['state',   state,                       'source',  r.source?.replace('ble:', '') ?? '--'],
            ['target',  n(r.target),                 'sent',    n(r.sent)],
            ['trainer', n(r.trainer),                'pedals',  n(r.meter)],
            ['ratio',   n(r.ratio, 3),               'offset',  pct(r.ratio)],
            ['avg trn', n(r.emaTrainer, 1),          'avg ped', n(r.emaMeter, 1)],
            ['paired',  `${n(r.paired)}s`,           'ped-tgt', `<span class="${errClass}">${exists(meterErr) ? (meterErr >= 0 ? '+' : '') + n(meterErr) : '--'}</span>`],
            ['sample',  ago(r.t, now),               'sent at', ago(this.lastSend, now)],
            ['steady',  exists(r.steady) ? `${r.steady}s` : '--', 'calm', exists(r.calm) ? `${Math.round(r.calm * 100)}%` : '--'],
        ];

        this.$grid.innerHTML = cells.map(([k1, v1, k2, v2]) =>
            `<span class="pmd--k">${k1}</span><span class="pmd--v">${v1}</span>` +
            `<span class="pmd--k">${k2}</span><span class="pmd--v">${v2}</span>`
        ).join('');

        this.$foot.textContent =
            `${powerMatch.log().length} rows${sim ? ' · SIMULATING' : ''}` +
            (r.event ? ` · ${r.event}` : '') +
            (this.version ? ` · ${this.version}` : '');
    }
}

customElements.define('power-match-debug', PowerMatchDebug);
