//
// Settings > Intervals.icu: the API key for the direct connection
// (models/intervals-direct.js). Save tests the key, pulls FTP and weight, and
// refreshes the Planned list.
//

import { xf, } from '../functions.js';
import direct from '../models/intervals-direct.js';
import intervals from '../models/intervals.js';

const style = `
intervals-direct-settings { display: block; }
intervals-direct-settings .ids--row {
    display: grid; grid-template-columns: 2fr 4fr; align-items: center; gap: 0.5em;
    margin: 0.4em 0;
}
intervals-direct-settings .ids--label {
    text-align: left; text-transform: uppercase; font-size: 0.9em; opacity: 0.8;
}
intervals-direct-settings input {
    width: 100%; box-sizing: border-box; padding: 0.5em 0.6em;
    color: var(--input-color, inherit); background: var(--chrome, transparent);
    border: 1px solid var(--border-color, #555); border-radius: 3px;
    font: inherit;
}
intervals-direct-settings .ids--buttons { display: flex; gap: 0.5em; flex-wrap: wrap; margin-top: 0.6em; }
intervals-direct-settings .btn { padding: 0.5em 1em; }
intervals-direct-settings .ids--status { margin-top: 0.8em; text-align: left; line-height: 1.5em; min-height: 1.5em; }
intervals-direct-settings .ids--status.ok   { color: #7bd88f; }
intervals-direct-settings .ids--status.fail { color: #ff7a7a; }
intervals-direct-settings .ids--help { margin-top: 0.6em; text-align: left; font-size: 0.85em; opacity: 0.7; line-height: 1.5em; }
intervals-direct-settings .ids--help a { color: inherit; text-decoration: underline; }
`;

class IntervalsDirectSettings extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = { signal: this.abortController.signal };

        if(!document.getElementById('intervals-direct-style')) {
            const el = document.createElement('style');
            el.id = 'intervals-direct-style';
            el.textContent = style;
            document.head.appendChild(el);
        }

        this.innerHTML = `
            <div class="ids--row">
                <label class="ids--label" for="ids--key">API key</label>
                <input id="ids--key" type="password" autocomplete="off" spellcheck="false" placeholder="paste the key">
            </div>
            <div class="ids--row">
                <label class="ids--label" for="ids--athlete">Athlete id</label>
                <input id="ids--athlete" type="text" autocomplete="off" spellcheck="false" placeholder="0 = the key's own athlete">
            </div>
            <div class="ids--buttons">
                <button class="btn" type="button" data-act="save">Save &amp; test</button>
                <button class="btn" type="button" data-act="sync">Sync now</button>
                <button class="btn" type="button" data-act="forget">Forget</button>
            </div>
            <div class="ids--status"></div>
            <div class="ids--help">
                The key is on intervals.icu under Settings → Developer Settings.
                It stays in this browser only. With it set, the Planned list shows
                this week's rides from the intervals.icu calendar, FTP and weight
                come from intervals.icu, and the intervals.icu button on a saved
                activity uploads the .fit straight there.
            </div>
        `;

        this.$key     = this.querySelector('#ids--key');
        this.$athlete = this.querySelector('#ids--athlete');
        this.$status  = this.querySelector('.ids--status');

        this.addEventListener('click', this.onClick.bind(this), signal);

        const saved = direct.load();
        this.$athlete.value = saved.athlete === '0' ? '' : saved.athlete;
        if(saved.key) {
            this.$key.placeholder = 'saved (paste to replace)';
            this.setStatus('Key saved. Use Sync now to refresh.', '');
            xf.dispatch('services', {intervals: true});
        } else {
            this.setStatus('Not connected.', '');
        }
    }

    disconnectedCallback() {
        this.abortController.abort();
    }

    setStatus(text, kind = '') {
        this.$status.textContent = text;
        this.$status.className = `ids--status ${kind}`;
    }

    async onClick(e) {
        const act = e.target?.dataset?.act;
        if(!act) return;

        if(act === 'save') {
            const key = this.$key.value.trim() || direct.load().key;
            if(!key) {
                this.setStatus('Paste the API key first.', 'fail');
                return;
            }
            direct.save({key, athlete: this.$athlete.value});
            this.$key.value = '';
            this.$key.placeholder = 'saved (paste to replace)';
            await this.test();
        }
        if(act === 'sync') {
            await this.test();
        }
        if(act === 'forget') {
            direct.clear();
            this.$key.value = '';
            this.$athlete.value = '';
            this.$key.placeholder = 'paste the key';
            xf.dispatch('services', {intervals: false});
            this.setStatus('Forgotten. Not connected.', '');
        }
    }

    async test() {
        this.setStatus('Checking…', '');
        try {
            const athlete = await direct.athlete();
            const settings = intervals.athleteToSettings(athlete);
            xf.dispatch('services', {intervals: true});

            // the same refresh the Planned list's intervals.icu button does,
            // which also sets FTP and weight
            xf.dispatch('action:planned', ':intervals:wod');

            this.setStatus(
                `Connected as ${athlete.name ?? athlete.id} (${athlete.id}) · ` +
                `FTP ${settings.ftp || '--'} W · ${settings.weight || '--'} kg. ` +
                `Planned rides refreshing.`, 'ok');
        } catch(error) {
            xf.dispatch('services', {intervals: false});
            this.setStatus(`Not connected: ${error.message}`, 'fail');
        }
    }
}

customElements.define('intervals-direct-settings', IntervalsDirectSettings);
