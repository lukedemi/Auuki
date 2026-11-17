#!/usr/bin/env node
//
// Group rides under stress: N simulated riders against a local auuki-group
// Worker (wrangler dev), each with its clock set wrong on purpose, riding a
// short workout while their sockets are cut and the server is killed and
// restarted mid-interval. doc/group-ride.md § Durability, Testing it.
//
//   node --no-warnings scripts/group-chaos.mjs            # 5 riders
//   node --no-warnings scripts/group-chaos.mjs --riders 8
//
// It starts and restarts `wrangler dev` itself (workers/group). Passes when:
// - every rider changes step within 100 ms (true time) of every other rider,
//   through all of it;
// - after each disruption, every rider sees every other rider's numbers
//   again within 5 s of the server being back.
// The riders use the app's own modules (src/group/*), not copies.
//

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { timeline, positionAt, positionKey } from '../src/group/schedule.js';
import { Clock } from '../src/group/clock.js';
import { Connection } from '../src/group/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.join(here, '..', 'workers', 'group');
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const N = Number(arg('riders', 5));
const SPREAD_MS = 100;
const RECOVER_MS = 5000;

const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();

// ---- the server ----

let server = null;
async function startServer() {
    server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--var', 'DEV:1', '--var', 'TOKEN_SECRET:dev-secret-dev-secret'], {
        cwd: workerDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    let out = '';
    server.stdout.on('data', (d) => { out += d; });
    server.stderr.on('data', (d) => { out += d; });
    for(let i = 0; i < 120; i++) {
        if(out.includes('Ready on')) return;
        await sleep(250);
    }
    throw new Error(`wrangler dev did not start:\n${out}`);
}
async function stopServer() {
    if(!server) return;
    const dead = new Promise((r) => server.once('exit', r));
    try { process.kill(-server.pid, 'SIGKILL'); } catch(_) {}
    await dead;
    server = null;
}

// ---- a rider ----

function Rider(i, ride, skewMs) {
    const local = () => performance.timeOrigin + performance.now() + skewMs;   // a wrong clock
    const clock = Clock({local});
    const sched = {startAt: ride.startAt, lobbyS: ride.lobbyS, timeline: timeline(ride.workout)};
    const r = {i, name: `rider${i}`, skewMs, changes: [], seen: new Map(), token: null, riderId: null, conn: null, lastKey: null, pingTimer: null};

    r.join = async () => {
        const res = await fetch(`${BASE}/api/group/${ride.id}/join`, {method: 'POST', body: JSON.stringify({key: ride.joinKey, name: r.name, token: r.token})});
        const body = await res.json();
        if(!res.ok) throw new Error(`join: ${res.status} ${JSON.stringify(body)}`);
        r.token = body.token;
        r.riderId = body.riderId;
    };

    r.connect = () => {
        r.conn = Connection({
            url: () => `${BASE.replace('http', 'ws')}/api/group/${ride.id}/ws?token=${encodeURIComponent(r.token)}`,
            onOpen: () => {
                clock.reset();
                r.conn.send({type: 'hello', history: []});
                for(let k = 0; k < 5; k++) setTimeout(() => r.conn.send(clock.ping()), k * 200);
            },
            onMessage: (m) => {
                if(m.type === 'pong') clock.onPong(m, local());
                if(m.type === 'tick') for(const id of Object.keys(m.riders)) r.seen.set(id, Date.now());
            },
        });
        r.conn.connect();
        r.pingTimer = setInterval(() => r.conn.send(clock.ping()), 30000);
    };

    // the browser's 50 ms ticker: note the true time each new step is seen
    r.ticker = setInterval(() => {
        const pos = positionAt(sched, clock.now());
        const key = pos.phase === 'workout' ? `${pos.intervalIndex}.${pos.stepIndex}` : pos.phase;
        if(key !== r.lastKey) {
            r.changes.push({key, at: Date.now()});
            r.lastKey = key;
        }
    }, 50);
    let lastSecond = null;
    r.sampler = setInterval(() => {
        const pos = positionAt(sched, clock.now());
        const k = positionKey(pos);
        if(k === lastSecond) return;
        lastSecond = k;
        r.conn?.send({type: 's', w: 200 + i, hr: 140 + i, cad: 90, tgt: 200, st8: 'r'});
    }, 100);

    r.stop = () => { clearInterval(r.ticker); clearInterval(r.sampler); clearInterval(r.pingTimer); r.conn?.close(); };
    return r;
}

// ---- the run ----

const failures = [];
async function waitAllSeeAll(riders, since, label) {
    const ids = riders.map((r) => r.riderId);
    const deadline = since + RECOVER_MS;
    while(Date.now() < deadline + 2000) {
        const ok = riders.every((r) => ids.every((id) => (r.seen.get(id) ?? 0) > since));
        if(ok) { log(`${label}: everyone sees everyone again after ${((Date.now() - since) / 1000).toFixed(1)} s`); return; }
        await sleep(100);
    }
    const missing = riders.map((r) => `${r.name}: ${ids.filter((id) => !((r.seen.get(id) ?? 0) > since)).length} missing`).join(', ');
    failures.push(`${label}: not recovered within ${RECOVER_MS / 1000} s (${missing})`);
    log(`${label}: NOT recovered — ${missing}`);
}

async function main() {
    log(`starting wrangler dev on :${PORT}`);
    await startServer();

    // 8 steps of 6 s: 48 s of workout, starting 12 s from now
    const workout = {meta: {name: 'Chaos'}, intervals: Array.from({length: 4}, () => ({steps: [{duration: 6, power: 1.1}, {duration: 6, power: 0.5}]}))};
    const startAt = Date.now() + 12000;
    const res = await fetch(`${BASE}/api/host/group`, {method: 'POST', body: JSON.stringify({title: 'Chaos ride', workout, startAt})});
    const created = await res.json();
    if(!res.ok) throw new Error(`create: ${res.status} ${JSON.stringify(created)}`);
    const ride = {...created, workout, lobbyS: 900};
    log(`ride ${ride.id}, ${ride.durationS} s, starts in 12 s`);

    const skews = [0, 10000, -3000, 250, -60000, 45000, -800, 7000, 1200, -15000];
    const riders = Array.from({length: N}, (_, i) => Rider(i, ride, skews[i % skews.length]));
    for(const r of riders) { await r.join(); r.connect(); }
    log(`${N} riders joined, clocks off by ${riders.map((r) => `${r.skewMs / 1000}s`).join(', ')}`);
    await sleep(3000);
    await waitAllSeeAll(riders, T0, 'start');

    // during the workout: one rider's network blips…
    await sleep(Math.max(0, startAt + 9000 - Date.now()));
    log('cutting rider1\'s socket');
    let t = Date.now();
    riders[1].conn.drop();
    await waitAllSeeAll(riders, t, 'one socket cut');

    // …everyone's sockets drop at once…
    await sleep(Math.max(0, startAt + 17000 - Date.now()));
    log('cutting every socket');
    t = Date.now();
    riders.forEach((r) => r.conn.drop());
    await waitAllSeeAll(riders, t, 'all sockets cut');

    // …and the server dies mid-interval, down for 4 s
    await sleep(Math.max(0, startAt + 27500 - Date.now()));
    log('killing the server (mid-step)');
    await stopServer();
    await sleep(4000);
    log('server back up');
    await startServer();
    t = Date.now();
    await waitAllSeeAll(riders, t, 'server restart');

    // ride on to the end
    await sleep(Math.max(0, startAt + ride.durationS * 1000 + 2000 - Date.now()));
    riders.forEach((r) => r.stop());

    // every step change, compared across riders in true time
    const keys = [...new Set(riders[0].changes.map((c) => c.key))];
    let worst = 0;
    for(const key of keys) {
        const times = riders.map((r) => r.changes.find((c) => c.key === key)?.at);
        if(times.some((x) => x === undefined)) { failures.push(`step ${key}: not every rider saw it`); continue; }
        const spread = Math.max(...times) - Math.min(...times);
        worst = Math.max(worst, spread);
        if(spread > SPREAD_MS) failures.push(`step ${key}: riders ${spread} ms apart`);
    }
    log(`${keys.length} phase/step changes; worst spread between riders ${worst} ms (limit ${SPREAD_MS})`);

    await stopServer();
    if(failures.length) {
        console.log(`\nFAIL\n- ${failures.join('\n- ')}`);
        process.exit(1);
    }
    console.log('\nPASS');
    process.exit(0);
}

main().catch(async (err) => {
    console.error(err);
    await stopServer();
    process.exit(1);
});
