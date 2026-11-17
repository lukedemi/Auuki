//
// Group rides on screen (group/group.js; doc/group-ride.md):
//
//   <group-join>    the join screen a ride's link opens on: the ride, the
//                   countdown, your name, Join. Also says when a ride is over.
//   <group-panel>   during the ride, in place of the live chart: the phase
//                   and the clock, everyone's video and numbers, the group
//                   chart, mic / camera / leave.
//   <group-create>  on the Workouts page: host a group ride of the workout
//                   that's loaded, at a time, and copy its link.
//
// Per rider: power (3 s feel from the 1 s numbers) big, with a sparkline of
// the last 2 minutes over their target and heart rate on its own scale; % of
// target coloured by zone; heart rate and cadence as numbers.
//

import { xf } from '../functions.js';
import { models } from '../models/models.js';
import { status, pctOfTarget } from '../group/riders.js';
import { rideLink } from '../group/group.js';

const ZONE_VAR = {
    one: '--zone-gray', two: '--zone-blue', three: '--zone-teal', four: '--zone-green',
    five: '--zone-yellow', six: '--zone-orange', seven: '--zone-red',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function clockText(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

export function phaseText(pos, ride) {
    if(!pos) return '';
    const n = ride?.workout?.intervals?.length ?? 0;
    switch(pos.phase) {
    case 'closed':   return `Lobby opens in ${clockText(pos.opensIn)}`;
    case 'warmup':   return `Warm-up · starts in ${clockText(pos.startsIn)}`;
    case 'workout':  return `Interval ${pos.intervalIndex + 1} of ${n} · ${clockText(pos.intervalLeft)} · ${clockText(pos.workoutLeft)} left`;
    case 'cooldown': return `Cool-down · ride as long as you like`;
    }
    return '';
}

function injectStyle(id, css) {
    if(document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = css;
    document.head.appendChild(el);
}

// ---------------------------------------------------------------- join ----

const joinStyle = `
group-join { position: fixed; inset: 0; z-index: 9990; display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,.72); font: 16px/1.45 system-ui, sans-serif; color: #eee; }
group-join.on { display: flex; }
group-join .gj--card { width: min(440px, calc(100vw - 32px)); background: var(--dark, #28272D); border-radius: 12px;
    padding: 22px 22px 18px; box-shadow: 0 8px 40px rgba(0,0,0,.6); box-sizing: border-box; }
group-join h2 { margin: 0 0 4px; font-size: 1.35em; }
group-join .gj--meta { opacity: .75; margin-bottom: 14px; }
group-join .gj--count { font-size: 2.4em; font-variant-numeric: tabular-nums; font-weight: 700; margin: 4px 0 12px; }
group-join label { display: block; margin: 10px 0 4px; opacity: .8; font-size: .9em; }
group-join input[type=text] { width: 100%; box-sizing: border-box; font: inherit; padding: 9px 10px; border-radius: 8px;
    border: 1px solid #555; background: #1b1b1f; color: inherit; }
group-join .gj--check { display: flex; gap: 8px; align-items: center; margin-top: 10px; opacity: .9; }
group-join .gj--check label { margin: 0; font-size: 1em; opacity: 1; }
group-join button { font: inherit; margin-top: 16px; width: 100%; padding: 11px; border-radius: 8px; border: 0;
    background: var(--zone-green, #57C057); color: #111; font-weight: 700; cursor: pointer; }
group-join button:disabled { opacity: .45; cursor: default; }
group-join .gj--error { color: #ff8a8a; margin-top: 10px; min-height: 1.2em; }
group-join .gj--note { opacity: .6; font-size: .85em; margin-top: 12px; }
`;

class GroupJoin extends HTMLElement {
    connectedCallback() {
        injectStyle('group-join-style', joinStyle);
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.ride = null;
        this.opensAt = null;
        xf.sub('group:ride', (r) => { this.ride = r; this.render(); }, signal);
        xf.sub('group:stage', (s) => this.onStage(s), signal);
        this.timer = setInterval(() => this.updateCount(), 500);
    }
    disconnectedCallback() {
        this.abort.abort();
        clearInterval(this.timer);
    }
    onStage({stage, error, opensAt, left}) {
        this.stage = stage;
        this.error = error ?? null;
        if(opensAt) this.opensAt = opensAt;
        // leaving on purpose needs no screen; the end screen is up
        this.classList.toggle('on', stage === 'join' || (stage === 'ended' && !!error && !left));
        this.render();
    }
    render() {
        if(!this.classList.contains('on')) return;
        const r = this.ride;
        if(this.stage === 'ended') {
            this.innerHTML = `<div class="gj--card"><h2>${esc(r?.title ?? 'Group ride')}</h2>
                <div class="gj--error">${esc(this.error)}</div>
                <button type="button" class="gj--close">OK</button></div>`;
            this.querySelector('.gj--close').addEventListener('click', () => this.classList.remove('on'));
            return;
        }
        const start = r ? new Date(r.startAt) : null;
        const mins = r ? Math.round(r.durationS / 60) : 0;
        this.innerHTML = `<div class="gj--card">
            <h2>${esc(r?.title ?? 'Group ride')}</h2>
            <div class="gj--meta">${esc(r?.workout?.meta?.name ?? '')} · ${mins} min · ${start ? start.toLocaleString([], {weekday: 'short', hour: 'numeric', minute: '2-digit'}) : ''}</div>
            <div class="gj--count"></div>
            <label for="gj-name">Your name</label>
            <input type="text" id="gj-name" maxlength="32" autocomplete="nickname" value="${esc(r?.name ?? '')}">
            <div class="gj--check"><input type="checkbox" id="gj-hr" checked><label for="gj-hr">Share my heart rate</label></div>
            <button type="button" class="gj--go">Join</button>
            <div class="gj--error">${esc(this.error ?? '')}</div>
            <div class="gj--note">You join muted with your camera on. Connect your trainer and heart-rate strap any time.</div>
        </div>`;
        const $name = this.querySelector('#gj-name');
        const go = () => {
            const name = $name.value.trim();
            if(!name) { $name.focus(); return; }
            this.querySelector('.gj--go').disabled = true;
            xf.dispatch('ui:group:join', {name, shareHr: this.querySelector('#gj-hr').checked});
        };
        this.querySelector('.gj--go').addEventListener('click', go);
        $name.addEventListener('keydown', (e) => { if(e.key === 'Enter') go(); });
        this.updateCount();
    }
    updateCount() {
        const $c = this.querySelector('.gj--count');
        if(!$c || !this.ride) return;
        const now = window.group?.clock?.now() ?? Date.now();
        const opens = this.ride.startAt - this.ride.lobbyS * 1000;
        const $go = this.querySelector('.gj--go');
        if(now < opens) {
            $c.textContent = `Lobby opens in ${clockText((opens - now) / 1000)}`;
            if($go) $go.disabled = true;
            this.wasClosed = true;
        } else {
            if(this.wasClosed && $go) { $go.disabled = false; this.wasClosed = false; }
            const s = (this.ride.startAt - now) / 1000;
            $c.textContent = s > 0 ? `Starts in ${clockText(s)}` : (s > -this.ride.durationS ? 'Under way — join in' : 'Cool-down');
        }
    }
}
customElements.define('group-join', GroupJoin);

// --------------------------------------------------------------- panel ----

const panelStyle = `
group-panel { position: absolute; inset: 0; z-index: 3; display: none; flex-direction: column; gap: 6px;
    padding: 6px 8px 8px; box-sizing: border-box; background: var(--background-color, #28272D);
    font: 14px/1.3 system-ui, sans-serif; color: var(--foreground-color, #eee); }
body.group-mode group-panel { display: flex; }
body.group-mode #graph-power live-chart, body.group-mode #graph-power room-status { visibility: hidden; }
group-panel .gp--bar { display: flex; align-items: center; gap: 10px; min-height: 30px; }
group-panel .gp--phase { font-weight: 700; font-size: 1.1em; font-variant-numeric: tabular-nums; flex: 1; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
group-panel .gp--conn { width: 9px; height: 9px; border-radius: 50%; background: var(--zone-green, #57C057); flex: none; }
group-panel .gp--conn.reconnecting, group-panel .gp--conn.connecting { background: var(--zone-yellow, #F8C73A); }
group-panel .gp--conn.ended { background: var(--zone-red, #FE340B); }
group-panel .gp--connlabel { opacity: .7; font-size: .9em; white-space: nowrap; }
group-panel button { font: inherit; color: inherit; background: transparent; border: 1px solid var(--border-color, #555);
    border-radius: 6px; padding: 3px 9px; cursor: pointer; white-space: nowrap; }
group-panel button.off { opacity: .5; text-decoration: line-through; }
group-panel button.live { background: var(--zone-red, #FE340B); border-color: transparent; color: #fff; }
group-panel button[hidden] { display: none; }
group-panel .gp--chart { height: 64px; flex: none; position: relative; }
group-panel .gp--chart canvas { width: 100%; height: 100%; display: block; }
group-panel .gp--grid { flex: 1; min-height: 0; display: grid; gap: 6px; grid-auto-rows: minmax(0, 1fr);
    grid-template-columns: repeat(var(--gp-cols, 2), minmax(0, 1fr)); }
group-panel .gp--tile { position: relative; border-radius: 8px; overflow: hidden; background: #111; min-height: 0; }
group-panel .gp--tile.me { outline: 2px solid var(--zone-blue, #328AFF); outline-offset: -2px; }
group-panel .gp--tile.speaking { outline: 3px solid var(--zone-green, #57C057); outline-offset: -3px; }
group-panel .gp--tile video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
group-panel .gp--tile .gp--avatar { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 2.4em; font-weight: 700; opacity: .25; }
group-panel .gp--tile.has-video .gp--avatar { display: none; }
group-panel .gp--over { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between;
    background: linear-gradient(rgba(0,0,0,.45), transparent 35%, transparent 55%, rgba(0,0,0,.65)); }
group-panel .gp--top { display: flex; justify-content: space-between; align-items: flex-start; padding: 4px 7px; gap: 6px; }
group-panel .gp--w { font-size: 2.1em; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; }
group-panel .gp--w small { font-size: .45em; font-weight: 600; opacity: .8; margin-left: 2px; }
group-panel .gp--pct { font-weight: 700; font-variant-numeric: tabular-nums; padding: 1px 6px; border-radius: 5px; color: #111; }
group-panel .gp--side { text-align: right; font-variant-numeric: tabular-nums; }
group-panel .gp--side div { white-space: nowrap; }
group-panel .gp--spark { height: 34%; min-height: 26px; }
group-panel .gp--spark canvas { width: 100%; height: 100%; display: block; }
group-panel .gp--bottom { display: flex; align-items: center; gap: 6px; padding: 0 7px 4px; }
group-panel .gp--name { font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
group-panel .gp--badge { font-size: .8em; padding: 0 6px; border-radius: 5px; background: rgba(255,255,255,.18); }
group-panel .gp--badge:empty { display: none; }
group-panel .gp--mic { font-size: .9em; }
group-panel .gp--kick { padding: 0 6px; font-size: .8em; }
group-panel .gp--tile.stale .gp--top, group-panel .gp--tile.reconnecting .gp--top, group-panel .gp--tile.gone .gp--top { opacity: .35; }
group-panel .gp--react { position: absolute; right: 8px; bottom: 34%; font-size: 2em; animation: gp-up 2s ease-out forwards; pointer-events: none; }
@keyframes gp-up { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-60px); opacity: 0; } }
@media (max-width: 700px) { group-panel .gp--chart { display: none; } group-panel .gp--w { font-size: 1.5em; } }
`;

const SPARK_S = 120;
const CHART_S = 600;

function cssVar(el, name, fallback) {
    return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}
function zoneColor(el, w, ftp) {
    if(!(ftp > 0) || !(w >= 0)) return cssVar(el, '--zone-gray', '#636468');
    const zone = models.ftp.powerToZone(w, ftp)?.name ?? 'one';
    return cssVar(el, ZONE_VAR[zone] ?? '--zone-gray', '#636468');
}
function sizeCanvas(c) {
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if(c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return {w, h, dpr};
}

class GroupPanel extends HTMLElement {
    connectedCallback() {
        injectStyle('group-panel-style', panelStyle);
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.tiles = new Map();
        this.media = null;
        this.mediaState = {available: false};
        this.speaker = null;
        this.innerHTML = `
            <div class="gp--bar">
                <span class="gp--conn"></span><span class="gp--connlabel"></span>
                <span class="gp--phase"></span>
                <button type="button" class="gp--micbtn" title="Microphone (M)" hidden>🎤 Muted</button>
                <button type="button" class="gp--cambtn" title="Camera" hidden>📷</button>
                <button type="button" class="gp--react-btn" title="Cheer">🔥</button>
                <button type="button" class="gp--close-btn" hidden title="End the ride for everyone">End ride</button>
                <button type="button" class="gp--leave">Leave</button>
            </div>
            <div class="gp--chart"><canvas></canvas></div>
            <div class="gp--grid"></div>`;
        this.$phase = this.querySelector('.gp--phase');
        this.$conn = this.querySelector('.gp--conn');
        this.$connLabel = this.querySelector('.gp--connlabel');
        this.$grid = this.querySelector('.gp--grid');
        this.$chart = this.querySelector('.gp--chart canvas');
        this.$mic = this.querySelector('.gp--micbtn');
        this.$cam = this.querySelector('.gp--cambtn');
        this.$close = this.querySelector('.gp--close-btn');

        this.$mic.addEventListener('click', () => this.toggleMic(), signal);
        this.$cam.addEventListener('click', () => xf.dispatch('ui:group:cam', !this.mediaState.cam), signal);
        this.querySelector('.gp--react-btn').addEventListener('click', () => xf.dispatch('ui:group:react', '🔥'), signal);
        this.querySelector('.gp--leave').addEventListener('click', () => {
            if(confirm('Leave the group ride? This ends and saves your ride.')) xf.dispatch('ui:group:leave');
        }, signal);
        this.$close.addEventListener('click', () => {
            if(confirm('End the ride for everyone?')) xf.dispatch('ui:group:close');
        }, signal);
        window.addEventListener('keydown', (e) => {
            if(e.code !== 'KeyM' || !document.body.classList.contains('group-mode')) return;
            if(['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
            this.toggleMic();
        }, signal);

        xf.sub('db:groupMode', (on) => document.body.classList.toggle('group-mode', !!on), signal);
        xf.sub('group:ride', (r) => { this.ride = r; }, signal);
        xf.sub('group:stage', (s) => { if(s.stage === 'riding') { this.isHost = !!s.host; this.$close.hidden = !this.isHost; } }, signal);
        xf.sub('group:position', (p) => { this.pos = p; this.$phase.textContent = phaseText(p, this.ride); }, signal);
        xf.sub('group:conn', (s) => this.onConn(s), signal);
        xf.sub('group:riders', (r) => { this.riders = r; this.schedule(); }, signal);
        xf.sub('group:media', (m) => this.onMedia(m), signal);
        xf.sub('group:speaker', (id) => { this.speaker = id; this.schedule(); }, signal);
        xf.sub('group:react', ({from, emoji}) => this.onReact(from, emoji), signal);
        this.ro = new ResizeObserver(() => this.schedule());
        this.ro.observe(this);
    }
    disconnectedCallback() {
        this.abort.abort();
        this.ro?.disconnect();
    }
    toggleMic() {
        if(this.mediaState.available) xf.dispatch('ui:group:mic', !this.mediaState.mic);
    }
    onConn(s) {
        this.$conn.className = `gp--conn ${s}`;
        this.$connLabel.textContent = s === 'reconnecting' ? 'reconnecting…' : s === 'connecting' ? 'connecting…' : '';
    }
    onMedia(m) {
        this.mediaState = m ?? {available: false};
        this.media = window.group?.media?.() ?? null;
        const on = !!this.mediaState.available;
        this.$mic.hidden = !on;
        this.$cam.hidden = !on;
        if(on) {
            this.$mic.textContent = this.mediaState.mic ? '🎤 Live' : '🎤 Muted';
            this.$mic.classList.toggle('live', !!this.mediaState.mic);
            this.$cam.classList.toggle('off', !this.mediaState.cam);
        }
        this.schedule();
    }
    onReact(from, emoji) {
        const tile = this.tiles.get(from);
        if(!tile) return;
        const el = document.createElement('div');
        el.className = 'gp--react';
        el.textContent = emoji;
        tile.el.appendChild(el);
        setTimeout(() => el.remove(), 2100);
    }
    schedule() {
        if(this.frame) return;
        this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
    }

    tile(r) {
        let t = this.tiles.get(r.id);
        if(t) return t;
        const el = document.createElement('div');
        el.className = 'gp--tile';
        el.innerHTML = `<video autoplay playsinline muted></video><div class="gp--avatar"></div>
            <div class="gp--over">
                <div class="gp--top"><div><div class="gp--w"></div></div><div class="gp--side"><div class="gp--pct"></div><div class="gp--hr"></div><div class="gp--cad"></div></div></div>
                <div><div class="gp--spark"><canvas></canvas></div>
                <div class="gp--bottom"><span class="gp--mic"></span><span class="gp--name"></span><span class="gp--badge"></span><button type="button" class="gp--kick" hidden title="Remove from the ride">✕</button></div></div>
            </div>`;
        t = {
            el, video: el.querySelector('video'), avatar: el.querySelector('.gp--avatar'), w: el.querySelector('.gp--w'),
            pct: el.querySelector('.gp--pct'), hr: el.querySelector('.gp--hr'), cad: el.querySelector('.gp--cad'),
            spark: el.querySelector('.gp--spark canvas'), name: el.querySelector('.gp--name'), badge: el.querySelector('.gp--badge'),
            mic: el.querySelector('.gp--mic'), kick: el.querySelector('.gp--kick'),
        };
        t.kick.addEventListener('click', () => {
            if(confirm(`Remove ${r.name || 'this rider'} from the ride?`)) xf.dispatch('ui:group:kick', r.id);
        });
        this.tiles.set(r.id, t);
        return t;
    }

    render() {
        if(!this.riders || !document.body.classList.contains('group-mode')) return;
        const list = this.riders.list().filter((r) => r.connected || r.me || this.riders.age(r) < 60);
        // the columns that keep tiles closest to 16:9
        const box = this.$grid.getBoundingClientRect();
        let best = 1, bestScore = Infinity;
        for(let c = 1; c <= Math.max(1, list.length); c++) {
            const rows = Math.ceil(list.length / c);
            const w = box.width / c, h = box.height / rows;
            const score = Math.abs(Math.log((w / h) / (16 / 9)));
            if(score < bestScore) { best = c; bestScore = score; }
        }
        this.$grid.style.setProperty('--gp-cols', best);

        const ids = new Set(list.map((r) => r.id));
        for(const [id, t] of this.tiles) if(!ids.has(id)) { t.el.remove(); this.tiles.delete(id); }
        list.forEach((r, i) => {
            const t = this.tile(r);
            if(this.$grid.children[i] !== t.el) this.$grid.insertBefore(t.el, this.$grid.children[i] ?? null);
            this.renderTile(r, t);
        });
        this.renderChart(list);
    }

    renderTile(r, t) {
        const st = status(this.riders, r);
        const s = r.latest ?? {};
        t.el.className = `gp--tile ${st}${r.me ? ' me' : ''}${this.speaker && this.speaker === r.id ? ' speaking' : ''}`;
        const hasVideo = this.media ? this.media.attach(r.id, t.video) && this.media.hasVideo(r.id) : false;
        t.el.classList.toggle('has-video', !!hasVideo);
        t.avatar.textContent = (r.name || '?').trim().slice(0, 1).toUpperCase();
        t.name.textContent = `${r.name || 'Rider'}${r.me ? ' (you)' : ''}${r.host ? ' · host' : ''}`;
        t.mic.textContent = this.media ? (this.media.isOn(r.id) ? '🎤' : '') : '';
        t.badge.textContent = {paused: 'paused', coasting: 'coasting', stale: '…', reconnecting: 'reconnecting', gone: 'left'}[st] ?? '';
        t.kick.hidden = !(this.isHost && !r.me);

        // 3 s average, as the main power number feels on a trainer
        const last3 = r.history.slice(-3).map((x) => x[1]).filter((x) => x !== null);
        const w3 = last3.length ? Math.round(last3.reduce((a, b) => a + b, 0) / last3.length) : (s.w ?? null);
        t.w.innerHTML = w3 === null ? '--' : `${w3}<small>W</small>`;
        const pct = pctOfTarget(w3, s.tgt);
        t.pct.textContent = pct === null ? '' : `${pct}%`;
        t.pct.style.background = pct === null ? 'transparent' : zoneColor(this, w3, s.ftp ?? s.tgt);
        t.hr.textContent = s.hr ? `♥ ${s.hr}` : '';
        t.cad.textContent = s.cad ? `${s.cad} rpm` : '';
        this.renderSpark(t.spark, r.history, s.ftp);
    }

    // power over target (zone-coloured target band), heart rate on its own scale
    renderSpark(c, rows, ftp) {
        const {w, h, dpr} = sizeCanvas(c);
        const g = c.getContext('2d');
        g.clearRect(0, 0, w, h);
        if(!rows.length) return;
        const end = rows[rows.length - 1][0];
        const from = end - SPARK_S;
        const pts = rows.filter((x) => x[0] > from);
        const maxW = Math.max(100, ...pts.map((x) => Math.max(x[1] ?? 0, x[4] ?? 0))) * 1.1;
        const X = (t) => ((t - from) / SPARK_S) * w;
        const Y = (v) => h - (v / maxW) * h;
        // target
        for(let i = 0; i < pts.length; i++) {
            const tg = pts[i][4];
            if(!(tg > 0)) continue;
            g.fillStyle = zoneColor(this, tg, ftp ?? tg);
            g.globalAlpha = 0.35;
            g.fillRect(X(pts[i][0] - 1), Y(tg), Math.max(1, w / SPARK_S + 0.5), h - Y(tg));
        }
        g.globalAlpha = 1;
        // power
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5 * dpr;
        g.beginPath();
        pts.forEach((x, i) => { const px = X(x[0]), py = Y(x[1] ?? 0); i ? g.lineTo(px, py) : g.moveTo(px, py); });
        g.stroke();
        // heart rate
        const hrs = pts.filter((x) => x[2] > 0);
        if(hrs.length > 1) {
            const lo = Math.min(...hrs.map((x) => x[2])) - 5, hi = Math.max(...hrs.map((x) => x[2])) + 5;
            g.strokeStyle = cssVar(this, '--zone-red', '#FE340B');
            g.globalAlpha = 0.85;
            g.lineWidth = 1 * dpr;
            g.beginPath();
            hrs.forEach((x, i) => { const px = X(x[0]), py = h - ((x[2] - lo) / (hi - lo)) * h; i ? g.lineTo(px, py) : g.moveTo(px, py); });
            g.stroke();
            g.globalAlpha = 1;
        }
    }

    // everyone's % of target, one line each, the last 10 minutes; 100% marked
    renderChart(list) {
        const c = this.$chart;
        if(!c.isConnected || c.getBoundingClientRect().height < 10) return;
        const {w, h, dpr} = sizeCanvas(c);
        const g = c.getContext('2d');
        g.clearRect(0, 0, w, h);
        const end = Math.max(0, ...list.map((r) => r.history[r.history.length - 1]?.[0] ?? 0));
        if(!end) return;
        // the last 10 minutes, or since the first number if that's less
        const first = Math.min(...list.map((r) => r.history[0]?.[0] ?? end));
        const span = Math.max(60, Math.min(CHART_S, end - first));
        const from = end - span;
        const lo = 50, hi = 150;
        const X = (t) => ((t - from) / span) * w;
        const Y = (p) => h - ((Math.min(hi, Math.max(lo, p)) - lo) / (hi - lo)) * h;
        g.strokeStyle = 'rgba(255,255,255,.25)';
        g.setLineDash([4 * dpr, 4 * dpr]);
        g.beginPath(); g.moveTo(0, Y(100)); g.lineTo(w, Y(100)); g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(255,255,255,.45)';
        g.font = `${10 * dpr}px system-ui, sans-serif`;
        g.fillText('100% of target', 4 * dpr, Y(100) - 3 * dpr);
        const palette = ['#328AFF', '#F8C73A', '#57C057', '#FF663A', '#44A5AB', '#c084fc', '#f472b6', '#a3e635', '#38bdf8', '#fb7185'];
        list.forEach((r, i) => {
            const pts = r.history.filter((x) => x[0] > from && x[4] > 0);
            if(pts.length < 2) return;
            g.strokeStyle = palette[i % palette.length];
            g.lineWidth = (r.me ? 2 : 1.25) * dpr;
            g.beginPath();
            let started = false;
            // 10 s smoothing so the lines can be told apart
            pts.forEach((x, j) => {
                const win = pts.slice(Math.max(0, j - 9), j + 1);
                const p = win.reduce((a, y) => a + (y[1] ?? 0) / y[4], 0) / win.length * 100;
                const px = X(x[0]), py = Y(p);
                started ? g.lineTo(px, py) : g.moveTo(px, py);
                started = true;
            });
            g.stroke();
            const t = this.tiles.get(r.id);
            if(t) t.name.style.borderBottom = `2px solid ${palette[i % palette.length]}`;
        });
    }
}
customElements.define('group-panel', GroupPanel);

// -------------------------------------------------------------- create ----

const createStyle = `
group-create { display: block; margin: 12px 16px 4px; font: 15px/1.45 system-ui, sans-serif; }
group-create .gc--box { border: 1px solid var(--border-color, #555); border-radius: 10px; padding: 12px 14px; }
group-create h2 { margin: 0 0 4px; font-size: 1.1em; }
group-create .gc--row { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-top: 8px; }
group-create label { display: flex; flex-direction: column; gap: 3px; font-size: .85em; opacity: .9; }
group-create input { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid #555; background: transparent; color: inherit; }
group-create input[type=text] { width: min(260px, 70vw); }
group-create button { font: inherit; padding: 7px 14px; border-radius: 6px; border: 0; cursor: pointer;
    background: var(--zone-green, #57C057); color: #111; font-weight: 700; }
group-create button.gc--secondary { background: transparent; color: inherit; border: 1px solid #555; font-weight: 500; }
group-create input.gc--link { width: min(520px, 90vw); font-size: .85em; }
group-create .gc--msg { margin-top: 6px; min-height: 1.2em; opacity: .85; }
group-create .gc--err { color: #ff8a8a; }
`;

// the next :00 or :30 at least 20 minutes away, for the time field
export function defaultStart(now = new Date()) {
    const d = new Date(now.getTime() + 20 * 60 * 1000);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() <= 30 ? (d.getMinutes() === 0 ? 0 : 30) : 60);
    return d;
}
function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

class GroupCreate extends HTMLElement {
    connectedCallback() {
        injectStyle('group-create-style', createStyle);
        this.abort = new AbortController();
        this.workout = null;
        xf.sub('db:workout', (w) => { this.workout = w; this.render(); }, {signal: this.abort.signal});
        this.render();
    }
    disconnectedCallback() {
        this.abort.abort();
    }
    render() {
        const name = this.workout?.meta?.name ?? 'the loaded workout';
        this.innerHTML = `<div class="gc--box">
            <h2>Group ride</h2>
            <div>Ride <b>${esc(name)}</b> together, starting at the same second, with video. Load a different workout below first to host that one.</div>
            <div class="gc--row">
                <label>Title<input type="text" class="gc--title" maxlength="80" value="${esc(name)}"></label>
                <label>Starts<input type="datetime-local" class="gc--start" value="${toLocalInput(defaultStart())}"></label>
                <button type="button" class="gc--go">Create group ride</button>
            </div>
            <div class="gc--msg"></div>
        </div>`;
        this.querySelector('.gc--go').addEventListener('click', () => this.create());
    }
    async create() {
        const $msg = this.querySelector('.gc--msg');
        const startAt = new Date(this.querySelector('.gc--start').value).getTime();
        const title = this.querySelector('.gc--title').value.trim();
        $msg.className = 'gc--msg';
        $msg.textContent = 'Creating…';
        try {
            const res = await fetch('/api/host/group', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({title, startAt, workout: this.workout}),
            });
            const body = await res.json().catch(() => ({}));
            if(!res.ok) throw new Error(body.error ?? `failed (${res.status})`);
            const guest = rideLink(body.guestOrigin || location.origin, body.id, body.joinKey);
            const mine = rideLink(location.origin, body.id, body.joinKey, body.hostKey);
            $msg.innerHTML = `<div>Send this link to everyone riding (they can join from 15 minutes before the start):</div>
                <div class="gc--row"><input type="text" class="gc--link" readonly value="${esc(guest)}">
                <button type="button" class="gc--copy gc--secondary">Copy link</button>
                <button type="button" class="gc--open">Go to the ride</button></div>
                <div style="opacity:.7;font-size:.85em;margin-top:4px">“Go to the ride” opens it as the host: you can remove riders and end the ride for everyone.</div>`;
            const $link = $msg.querySelector('.gc--link');
            $msg.querySelector('.gc--copy').addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(guest); } catch(_) { $link.select(); document.execCommand('copy'); }
                $msg.querySelector('.gc--copy').textContent = 'Copied';
            });
            $msg.querySelector('.gc--open').addEventListener('click', () => { location.href = mine; });
        } catch(err) {
            $msg.className = 'gc--msg gc--err';
            $msg.textContent = err.message;
        }
    }
}
customElements.define('group-create', GroupCreate);
