//
// Settings > Strava (this fork, Nov 17, 2026): connect a rider's Strava so
// their finished rides are uploaded there (models/strava-direct.js).
//
// Not connected: Strava's own "Connect with Strava" button, linking straight
// to strava.com/oauth/authorize as its brand guidelines require. Connected:
// who, and Disconnect (revoked at Strava, forgotten here). The "Compatible
// with Strava" mark sits beside it, smaller than ERGatory's own name, never
// as an icon.
//
// The return from Strava (?state=ergatory-…&code=…) is handled here on load:
// the code is swapped for tokens, the address cleaned, and Settings opened
// on this card with the outcome.
//

import { xf } from '../functions.js';
import strava from '../models/strava-direct.js';
import { flags, PUBLIC_URL } from '../flavor.js';
import connectButton from 'url:../images/connections/strava/btn_strava_connect_with_orange.svg';
import compatible from 'url:../images/connections/strava/api_logo_cptblWith_strava_horiz_white.svg';

const style = `
strava-settings { display: block; width: 100%; font-size: 15px; text-align: left; }
strava-settings .sv--row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 6px 0; }
strava-settings .sv--note { opacity: 0.7; font-size: 14px; line-height: 1.45; margin: 6px 0; max-width: 46em; }
strava-settings .sv--who { font-weight: 700; }
strava-settings .sv--connect img { height: 48px; display: block; }
strava-settings .sv--compatible { height: 13px; opacity: 0.7; margin-left: auto; }
strava-settings button {
    font: 600 14px system-ui, sans-serif; padding: 8px 14px; border-radius: 8px; cursor: pointer;
    color: inherit; background: var(--chrome, #2a2d34); border: 1px solid var(--border-color, #3a3d45);
}
strava-settings .sv--msg.ok { color: #6fdc9b; }
strava-settings .sv--msg.bad { color: #ff8c8c; }
`;

class StravaSettings extends HTMLElement {
    async connectedCallback() {
        if(!document.getElementById('strava-settings-style')) {
            const el = document.createElement('style');
            el.id = 'strava-settings-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.msg = null;
        this.clientId = null;
        if(!flags.strava) {
            this.innerHTML = `<p class="sv--note">Strava connects on the public ERGatory, <a class="a" href="${PUBLIC_URL}/">ergatory.d3-mi.com</a>, where its Strava app sends riders back. This household copy doesn't upload to Strava; your own rides reach it through bikes.</p>`;
            return;
        }
        this.render();
        // back from Strava?
        try {
            const res = await strava.handleReturn();
            if(res) {
                history.replaceState({}, document.title, location.pathname);
                this.msg = res.ok
                    ? ['ok', `Connected${res.athlete?.firstname ? ` as ${res.athlete.firstname} ${res.athlete.lastname ?? ''}` : ''}. Rides you finish from now on go to your Strava.`]
                    : ['bad', `Not connected: ${res.reason}.`];
                xf.dispatch('ui:page-set', 'settings');
                setTimeout(() => this.scrollIntoView({block: 'center'}), 300);
            }
        } catch(e) {
            this.msg = ['bad', `Not connected: ${e.message}.`];
        }
        try {
            const cfg = await strava.config();
            this.clientId = cfg?.client_id ?? null;
        } catch(e) {}
        this.render();
    }

    render() {
        const who = strava.athlete();
        const msg = this.msg ? `<p class="sv--msg ${this.msg[0]}">${this.msg[1]}</p>` : '';
        const mark = `<img class="sv--compatible" src="${compatible}" alt="Compatible with Strava">`;
        if(strava.isConnected()) {
            this.innerHTML = `
                <div class="sv--row">
                    <span>Connected as <span class="sv--who">${esc([who?.firstname, who?.lastname].filter(Boolean).join(' ') || 'your Strava')}</span></span>
                    <button type="button" data-act="disconnect">Disconnect</button>
                    ${mark}
                </div>
                <p class="sv--note">Each ride you finish is uploaded to your Strava, with its name and notes; edits you make afterwards follow it there. ERGatory only uploads: it reads nothing from your Strava but your name.</p>
                ${msg}`;
            this.querySelector('[data-act="disconnect"]').addEventListener('click', async () => {
                await strava.disconnect();
                this.msg = ['ok', 'Disconnected. ERGatory no longer has access to your Strava.'];
                this.render();
            });
            return;
        }
        if(!this.clientId) {
            this.innerHTML = `<p class="sv--note">Strava isn't set up on this copy of ERGatory.</p>${msg}`;
            return;
        }
        this.innerHTML = `
            <div class="sv--row">
                <a class="sv--connect" href="${esc(strava.connectUrl(this.clientId))}"><img src="${connectButton}" alt="Connect with Strava"></a>
                ${mark}
            </div>
            <p class="sv--note">Connect to have each ride you finish uploaded to your Strava, with its name and notes. Strava asks you to allow ERGatory to upload activities; it reads nothing else. Disconnect here any time.</p>
            ${msg}`;
        // a fresh state each time the link is used
        this.querySelector('.sv--connect').addEventListener('click', (e) => { e.currentTarget.href = strava.connectUrl(this.clientId); });
    }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

customElements.define('strava-settings', StravaSettings);

export { StravaSettings };
