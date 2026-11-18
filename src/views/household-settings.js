//
// Settings > Household, on the public infERGno only (household.js,
// transfer-in.js): sign in to the household for its extras on this site,
// see who is signed in, sign out, and bring settings and rides over from
// auuki.d3-mi.com again.
//
import { xf } from '../functions.js';
import { FLAVOR } from '../flavor.js';
import { isHousehold, householdEmail, check } from '../household.js';
import { lastTransfer, transferAndReload } from '../transfer-in.js';

const style = `
household-settings { display: block; width: 100%; font-size: 15px; text-align: left; }
household-settings .hh--row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 6px 0; }
household-settings .hh--note { opacity: 0.7; font-size: 14px; line-height: 1.45; margin: 6px 0; max-width: 46em; }
household-settings a.hh--btn, household-settings button {
    font: 600 14px system-ui, sans-serif; padding: 8px 14px; border-radius: 8px; cursor: pointer; text-decoration: none;
    color: inherit; background: var(--chrome, #2a2d34); border: 1px solid var(--border-color, #3a3d45); display: inline-block;
}
household-settings .hh--msg.ok { color: #6fdc9b; }
household-settings .hh--msg.bad { color: #ff8c8c; }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const when = (ts) => new Date(ts).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

class HouseholdSettings extends HTMLElement {
    connectedCallback() {
        if(FLAVOR !== 'public') { this.closest('.list--sub-section')?.remove(); return; }
        if(!document.getElementById('household-settings-style')) {
            const el = document.createElement('style');
            el.id = 'household-settings-style';
            el.textContent = style;
            document.head.appendChild(el);
        }
        this.msg = null;
        xf.sub('household:status', () => this.render());
        this.render();
    }
    render() {
        const msg = this.msg ? `<p class="hh--msg ${this.msg[0]}">${esc(this.msg[1])}</p>` : '';
        if(!isHousehold()) {
            this.innerHTML = `
                <div class="hh--row"><a class="hh--btn" href="/household">Household sign-in</a></div>
                <p class="hh--note">For the household only: signs this browser in (for a month), which turns on the trainer room and debug traces here, and the log at /admin. Everyone else can ignore this; the app works the same without it.</p>${msg}`;
            return;
        }
        const t = lastTransfer();
        const moved = t ? (t.error ? `Last try to bring things over from auuki.d3-mi.com failed: ${t.error}.` : `Brought over from auuki.d3-mi.com ${when(t.at)}: ${t.settings} settings, ${t.rides} rides, ${t.workouts} workouts.`) : '';
        this.innerHTML = `
            <div class="hh--row">
                <span>Signed in as household${householdEmail() ? ` (<b>${esc(householdEmail())}</b>)` : ''}</span>
                <button type="button" data-act="transfer">Bring over from auuki.d3-mi.com</button>
                <a class="hh--btn" href="/cdn-cgi/access/logout">Sign out</a>
            </div>
            <p class="hh--note">The trainer room and debug traces are on here; the log is at <a class="a" href="/admin">/admin</a>. ${esc(moved)}</p>${msg}`;
        this.querySelector('[data-act="transfer"]').addEventListener('click', async (e) => {
            // the popup must open inside the click, before anything is redrawn
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                await transferAndReload('auuki');
            } catch(err) {
                this.msg = ['bad', err.message];
                this.render();
            }
        });
    }
}

customElements.define('household-settings', HouseholdSettings);
