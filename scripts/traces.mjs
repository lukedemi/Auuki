#!/usr/bin/env node
// Read the app's debug traces (D1 `auuki`, written by functions/api/trace.js).
//
//   node scripts/traces.mjs                      the latest sessions
//   node scripts/traces.mjs <session|latest>     that session's rows, oldest first
//       --kind state,event,error                 only these kinds
//       --since 10m                              only the last 10 minutes (s, m, h)
//       --follow                                 keep polling for new rows (live)
//       --json                                   raw rows
//       --local                                  the local D1 (wrangler pages dev)
//
// Needs CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID, as wrangler does.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--kind', '--since'].includes(args[i - 1])));

function sql(command) {
    const where = args.includes('--local') ? '--local' : '--remote';
    const out = execFileSync('npx', ['--yes', 'wrangler', 'd1', 'execute', 'auuki', where, '--json', '--command', command],
        {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024});
    return JSON.parse(out)[0].results;
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const t = (ms) => new Date(ms).toLocaleTimeString('en-US', {timeZone: 'America/New_York', hour12: false});
const d = (ms) => new Date(ms).toLocaleString('en-US', {timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short'});

function since(spec) {
    if(!spec || spec === true) return 0;
    const m = /^(\d+)([smh])$/.exec(spec);
    if(!m) throw new Error(`--since wants 30s, 10m or 2h, not ${spec}`);
    return Date.now() - Number(m[1]) * {s: 1e3, m: 6e4, h: 36e5}[m[2]];
}

function line(r) {
    const data = r.data ? JSON.parse(r.data) : {};
    if(r.kind === 'state') {
        const x = data;
        return `${t(r.ts)}  state  ${x.status ?? ''} t=${x.elapsed ?? ''}  ${x.power ?? '-'} W → tgt ${x.target ?? '-'} sent ${x.sent ?? '-'}  hr ${x.hr ?? '-'} cad ${x.cad ?? '-'}${x.ratio ? `  ratio ${x.ratio}` : ''}  ${x.mode ?? ''}`;
    }
    if(r.kind === 'event') {
        const {name, ...rest} = data;
        return `${t(r.ts)}  event  ${name}${Object.keys(rest).length ? '  ' + JSON.stringify(rest) : ''}`;
    }
    return `${t(r.ts)}  ${r.kind.padEnd(5)}  ${data.text ?? JSON.stringify(data)}${data.stack ? '\n' + data.stack : ''}`;
}

const target = positional[0];
if(!target) {
    const rows = sql('SELECT session, started, last, who, version, rows, ua FROM sessions ORDER BY last DESC LIMIT 20');
    for(const s of rows) {
        console.log(`${s.session}  ${d(s.started)} → ${t(s.last)}  ${String(s.rows).padStart(6)} rows  ${s.who || ''}  ${s.version || ''}`);
    }
    process.exit(0);
}

const session = target === 'latest' ? sql('SELECT session FROM sessions ORDER BY last DESC LIMIT 1')[0]?.session : target;
if(!session) { console.error('no sessions yet'); process.exit(1); }
const kinds = flag('kind') && flag('kind') !== true ? String(flag('kind')).split(',') : null;
let lastId = 0;
const from = since(flag('since'));

function fetchRows() {
    const where = [`session = ${q(session)}`, `id > ${lastId}`];
    if(from) where.push(`ts >= ${from}`);
    if(kinds) where.push(`kind IN (${kinds.map(q).join(',')})`);
    const rows = sql(`SELECT id, ts, kind, data FROM traces WHERE ${where.join(' AND ')} ORDER BY id LIMIT 5000`);
    for(const r of rows) {
        lastId = Math.max(lastId, r.id);
        console.log(flag('json') ? JSON.stringify(r) : line(r));
    }
    return rows.length;
}

console.error(`session ${session}`);
fetchRows();
if(flag('follow')) {
    setInterval(() => { try { fetchRows(); } catch(e) { console.error(e.message); } }, 5000);
}
