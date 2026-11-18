//
// /admin: the log (src/log.js, functions/api/log.js), read back for the
// household (Access guards /admin and /api/admin). Everyone on the left, the
// newest first; their events on the right, newest first, live every 10 s.
//
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const when = (ts) => new Date(ts).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'});
const ago = (ts) => { const s = (Date.now() - ts) / 1000; return s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const browser = (ua = '') => (/iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '') + (/Edg\//.test(ua) ? ' Edge' : /Chrome\//.test(ua) ? ' Chrome' : /Firefox\//.test(ua) ? ' Firefox' : /Safari\//.test(ua) ? ' Safari' : '');

let visitor = null, oldest = null, timer = null;
const api = async (path) => { const r = await fetch(`./api/admin/${path}`, {cache: 'no-store'}); if(!r.ok) throw new Error(`${r.status}`); return r.json(); };

async function tiles() {
    const s = await api('summary');
    $('tiles').innerHTML = [[s.visitors.day, 'visitors today'], [s.visitors.week, 'this week'], [s.events.day, 'events today'], [s.riders, 'Strava riders'], [s.groupRides30d, 'group rides 30 d'], [s.errorsDay, 'errors today']]
        .map(([v, k]) => `<div class="tile"><b>${v}</b><span>${k}</span></div>`).join('');
}
async function visitors() {
    const {visitors: list} = await api('visitors?limit=300');
    $('visitors').innerHTML = list.map((v) => `<div class="v ${v.visitor === visitor ? 'on' : ''}" data-v="${esc(v.visitor)}">
        <div class="who">${esc(v.who || `anonymous ${v.visitor.slice(0, 6)}`)}</div>
        <div class="meta">${ago(v.last_seen)} · ${v.events} events · ${esc([v.city, v.country].filter(Boolean).join(', '))} · ${esc(browser(v.ua))}</div>
        <div class="meta">first seen ${when(v.first_seen)}</div></div>`).join('') || '<p class="muted" style="padding:16px">Nobody yet.</p>';
}
function query(before) {
    const p = new URLSearchParams({limit: '200'});
    if(visitor) p.set('visitor', visitor);
    if($('kind').value) p.set('kind', $('kind').value);
    if($('q').value.trim()) p.set('q', $('q').value.trim());
    if(before) p.set('before', String(before));
    return `events?${p}`;
}
const rowHtml = (e) => `<tr><td class="t">${when(e.ts)}</td><td class="w" title="${esc(e.who ?? '')}">${esc(e.who || `anon ${String(e.visitor ?? '').slice(0, 6)}`)}</td>
    <td class="k ${e.kind === 'error' ? 'error' : e.source === 'server' ? 'server' : ''}">${esc(e.kind)}</td>
    <td class="d">${esc(e.data ?? '')}${e.path && e.path !== '/' ? ` <span class="muted">${esc(e.path)}</span>` : ''} <span class="muted">${esc(e.host ?? '')}</span></td></tr>`;
async function events(more = false) {
    const {events: list} = await api(query(more ? oldest : null));
    if(list.length) oldest = list[list.length - 1].ts;
    const html = list.map(rowHtml).join('');
    if(more) $('events').insertAdjacentHTML('beforeend', html); else $('events').innerHTML = html || '<tr><td class="muted">No events.</td></tr>';
    $('more').hidden = list.length < 200;
}
async function refresh() {
    try { await Promise.all([tiles(), visitors(), events()]); $('updated').textContent = `updated ${new Date().toLocaleTimeString()}`; }
    catch(e) { $('updated').textContent = e.message === '403' ? 'household only: sign in through Settings → Household' : `could not load (${e.message})`; }
}

$('visitors').addEventListener('click', (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if(!v) return;
    visitor = v;
    $('showing').textContent = e.target.closest('[data-v]').querySelector('.who').textContent;
    refresh();
});
$('all').addEventListener('click', () => { visitor = null; $('showing').textContent = 'Everyone'; refresh(); });
$('kind').addEventListener('change', () => events());
let typing = null;
$('q').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => events(), 300); });
$('more').addEventListener('click', () => events(true));
const live = () => { clearInterval(timer); if($('live').checked) timer = setInterval(refresh, 10000); };
$('live').addEventListener('change', live);
refresh();
live();
