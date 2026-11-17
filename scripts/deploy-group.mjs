#!/usr/bin/env node
//
// Deploy workers/group (auuki-group), unless a group ride is on.
//
// During a ride the Durable Object never goes idle, so Cloudflare can't
// hold a code update until it does: the update is forced and every rider's
// socket drops (they reconnect within seconds, and nobody's workout
// notices, but there's no reason to do it). So this asks D1 for any ride
// from its lobby opening to 2 h after its end, and refuses while there is
// one. doc/group-ride.md § Durability.
//
//   node scripts/deploy-group.mjs           # from the repo root
//   node scripts/deploy-group.mjs --force   # deploy anyway
//
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workerDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workers', 'group');
const force = process.argv.includes('--force');
const wrangler = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args], {cwd: workerDir, encoding: 'utf8', ...opts});

const now = Date.now();
const LOBBY_MS = 15 * 60 * 1000;
const AFTER_MS = 2 * 3600 * 1000;
const sql = `SELECT id, title, start_at, duration_s FROM group_rides
    WHERE closed IS NULL AND start_at - ${LOBBY_MS} <= ${now} AND start_at + duration_s * 1000 + ${AFTER_MS} >= ${now}`;

let live = [];
try {
    const out = JSON.parse(wrangler(['d1', 'execute', 'auuki', '--remote', '--json', '--command', sql]));
    live = out?.[0]?.results ?? [];
} catch(err) {
    console.error('Could not check D1 for rides in progress:', err.message.split('\n')[0]);
    if(!force) { console.error('Not deploying. Use --force to deploy without checking.'); process.exit(1); }
}

if(live.length) {
    console.log('Group rides on now:');
    for(const r of live) console.log(`  ${r.id}  ${r.title}  starts ${new Date(r.start_at).toLocaleString()}  (${Math.round(r.duration_s / 60)} min)`);
    if(!force) { console.log('Not deploying: riders would be disconnected. Use --force to deploy anyway.'); process.exit(1); }
    console.log('--force: deploying anyway.');
}

wrangler(['deploy'], {stdio: 'inherit'});
