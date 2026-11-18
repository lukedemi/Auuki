//
// Home (the workout selector): the rider's Strava, at the top of the lists
// (rider, Nov 18, 2026: "the strava connection button should be there on the
// home page nicely fit in … essentially that's their username next to
// strava it can say 'connect with strava to save your settings and
// automatically upload'").
//
// Not connected: Strava's own Connect button (its brand guidelines ask for
// that exact button, linking to strava.com/oauth/authorize) and what it is
// for. Connected: the rider's name, as their account here, and whether their
// settings are saved (rider-sync.js). Public site only; Settings > Strava has
// Disconnect.
//
import { xf } from '../functions.js';
import strava from '../models/strava-direct.js';
import { flags } from '../flavor.js';
import connectButton from 'url:../images/connections/strava/btn_strava_connect_with_orange.svg';
import compatible from 'url:../images/connections/strava/api_logo_cptblWith_strava_horiz_white.svg';

const style = `
strava-home { display: block; margin: 0.8em 0.8em 0.2em; }
strava-home[hidden] { display: none; }
strava-home .sh--card {
    display: flex; align-items: center; gap: 0.9em 1.1em; flex-wrap: wrap;
    padding: 0.8em 1em; border-radius: 0.8em;
    background: var(--white-opacity-01, rgba(255,255,255,0.05)); border: 1px solid var(--white-opacity-02, rgba(255,255,255,0.1));
}
strava-home .sh--connect img { height: 40px; display: block; }
@media (max-width: 640px) { strava-home .sh--connect img { height: 34px; } strava-home .sh--text { font-size: 0.85em; } }
strava-home .sh--text { flex: 1 1 16em; font-size: 0.95em; line-height: 1.4; text-align: left; }
strava-home .sh--who { font-weight: 700; font-size: 1.05em; }
strava-home .sh--sub { opacity: 0.7; font-size: 0.9em; }
strava-home .sh--sub.bad { color: #ff8c8c; opacity: 1; }
strava-home .sh--sub.ok { color: #6fdc9b; opacity: 1; }
strava-home .sh--mark { height: 12px; opacity: 0.6; }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

class StravaHome extends HTMLElement {
    connectedCallback() {
        if(!flags.strava) { this.hidden = true; return; }
        if(!document.getElementById('strava-home-style')) {
            const el = document.createElement('style');
            el.id = 'strava-home-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.abortController = new AbortController();
        const signal = {signal: this.abortController.signal};
        this.clientId = null;
        this.rider = {status: 'off'};
        this.msg = null;
        xf.sub('rider:status', (s) => { this.rider = s; this.render(); }, signal);
        xf.sub('strava:return', (res) => {
            this.msg = res.ok ? null : ['bad', `Not connected: ${res.reason}.`];
            this.render();
        }, signal);
        xf.sub('strava:disconnected', () => { this.msg = null; this.render(); }, signal);
        strava.config().then((c) => { this.clientId = c?.client_id ?? null; this.render(); }).catch(() => {});
        this.render();
    }
    disconnectedCallback() { this.abortController?.abort(); }
    render() {
        const mark = `<img class="sh--mark" src="${compatible}" alt="Compatible with Strava">`;
        if(strava.isConnected()) {
            const a = strava.athlete();
            const name = this.rider.name || [a?.firstname, a?.lastname].filter(Boolean).join(' ') || 'your Strava';
            const sub = this.rider.status === 'error'
                ? `<div class="sh--sub bad">Settings not saved just now: ${esc(this.rider.error)}. Trying again in a minute.</div>`
                : this.rider.status === 'saved'
                    ? `<div class="sh--sub">Settings saved to your account · rides upload to Strava automatically</div>`
                    : `<div class="sh--sub">Rides upload to Strava automatically</div>`;
            this.innerHTML = `<div class="sh--card"><div class="sh--text"><div class="sh--who">${esc(name)}</div>${sub}</div>${mark}</div>`;
            return;
        }
        if(!this.clientId) { this.innerHTML = ''; return; }
        const msg = this.msg ? `<div class="sh--sub ${this.msg[0]}">${esc(this.msg[1])}</div>` : '';
        this.innerHTML = `<div class="sh--card">
            <a class="sh--connect" href="${esc(strava.connectUrl(this.clientId))}"><img src="${connectButton}" alt="Connect with Strava"></a>
            <div class="sh--text">Connect with Strava to save your settings and automatically upload${msg}</div>
        </div>`;
        this.querySelector('.sh--connect').addEventListener('click', (e) => { e.currentTarget.href = strava.connectUrl(this.clientId); });
    }
}

customElements.define('strava-home', StravaHome);
export { StravaHome };
