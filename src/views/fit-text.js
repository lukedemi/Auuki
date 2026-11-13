//
// Numbers as big as their tiles allow (this fork, Nov 13, 2026, rider: "All
// of the numbers right now are too small ... numbers should be as big as
// possible in that area"). On the desktop layout every value in the left
// column is sized to fill its tile: the width its text needs is measured
// with every digit as 0 (tabular figures, so 01:55 and 18:42 take the same
// room and the size does not twitch every second), and the font is the
// largest that fits both the width and the height left under the heading.
// Refitted when the window changes size or a value changes length.
//

const DESKTOP = '(min-width: 1200px) and (min-height: 650px) and (orientation: landscape)';
const VALUES = '.data-tiles .data-tile--value, .data-tiles .data-tile-small--value, .lap-tile--value';
const TILES = '.data-tile, .data-tile--small, .lap-tile';

const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const ctx = canvas?.getContext?.('2d');

// the text's width at 100px, digits as 0
export function templateOf(text) {
    return String(text ?? '').trim().replace(/[0-9]/g, '0');
}

export function fitSize({width, height, textWidth100, fill = 0.92, lineHeight = 1.0}) {
    if(!(width > 0) || !(height > 0) || !(textWidth100 > 0)) return null;
    const byWidth = (width * fill) / textWidth100 * 100;
    const byHeight = (height * fill) / lineHeight;
    return Math.max(8, Math.floor(Math.min(byWidth, byHeight)));
}

function measure(el, text) {
    if(!ctx) return 0;
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
    return ctx.measureText(text).width;
}

function visibleHeading(tile) {
    return Array.from(tile.querySelectorAll('h2, h3')).find((h) => h.offsetParent !== null);
}

// A row reads as one: every value in it takes the size of the one with the
// least room (tiles side by side, or a row of the Lap section). Tiles are in
// the same row when their vertical middles are within 24px.
export function groupRows(items, tolerance = 24) {
    const sorted = items.slice().sort((a, b) => a.mid - b.mid);
    const rows = [];
    for(const it of sorted) {
        const row = rows.find((r) => r.scope === it.scope && Math.abs(r.mid - it.mid) <= tolerance);
        if(row) row.items.push(it); else rows.push({scope: it.scope, mid: it.mid, items: [it]});
    }
    return rows;
}

let lastTemplates = '';

function fitAll(force = false) {
    const els = Array.from(document.querySelectorAll(VALUES));
    if(!window.matchMedia(DESKTOP).matches) {
        els.forEach((el) => { if(el.style.fontSize) el.style.fontSize = ''; });
        lastTemplates = '';
        return;
    }
    const visible = els.filter((el) => el.offsetParent !== null && el.closest(TILES));
    const templates = visible.map((el) => templateOf(el.textContent)).join('|');
    if(!force && templates === lastTemplates) return;
    lastTemplates = templates;

    const items = [];
    for(const el of visible) {
        const tile = el.closest(TILES);
        const heading = visibleHeading(tile);
        const size = fitSize({
            width: tile.clientWidth,
            height: tile.clientHeight - (heading ? heading.offsetHeight + 6 : 0),
            textWidth100: measure(el, templateOf(el.textContent) || '--'),
        });
        if(!size) continue;
        const r = tile.getBoundingClientRect();
        items.push({el, size, mid: r.top + r.height / 2, scope: tile.closest('.lap-section') ? 'lap' : 'main'});
    }
    for(const row of groupRows(items)) {
        const size = Math.min(...row.items.map((i) => i.size));
        for(const i of row.items) i.el.style.fontSize = `${size}px`;
    }
}

function start() {
    const root = document.querySelector('.data-tiles');
    if(!root) return;
    const resize = new ResizeObserver(() => fitAll(true));
    resize.observe(root);
    document.querySelectorAll(TILES).forEach((t) => resize.observe(t));
    // a value changing length (-- to 252, 9:59 to 10:00) refits; the same
    // length does nothing, so the numbers do not twitch every second
    const changes = new MutationObserver(() => fitAll());
    document.querySelectorAll(VALUES).forEach((el) => changes.observe(el, {characterData: true, childList: true, subtree: true}));
    window.matchMedia(DESKTOP).addEventListener?.('change', () => fitAll(true));
    // fonts arrive late; and z-stack switches change which value shows
    document.fonts?.ready?.then(() => fitAll(true));
    document.addEventListener('pointerup', () => setTimeout(() => fitAll(true), 50));
    fitAll(true);
}

if(typeof window !== 'undefined' && typeof document !== 'undefined') {
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else setTimeout(start, 0);
}
