//
// Settings > About: the version running, from version.json (the commit and
// build time written at release), and which build it is (flavor.js).
//

import { FLAVOR } from '../flavor.js';

class AboutVersion extends HTMLElement {
    connectedCallback() {
        const label = FLAVOR === 'public' ? 'public' : 'household';
        this.textContent = label;
        if(typeof fetch !== 'function') return;
        fetch('./version.json', {cache: 'no-store'})
            .then((r) => (r.ok ? r.json() : null))
            .then((v) => { if(v?.sha) this.textContent = `${v.sha} · built ${v.built} · ${label}`; })
            .catch(() => {});
    }
}

customElements.define('about-version', AboutVersion);
