# Group rides — architecture design

Status: design only, nothing built. November 2026.

## What it does

1. A host creates a **group ride**: a workout from the library or the intervals.icu calendar (say, VO2 max 5×4′), a title and a start time. They get a link.
2. Anyone with the link can open it **up to 15 minutes before** the start. They land in **warmup**: no workout running, ERG target (or resistance) set however they like, everyone's video, audio and numbers on screen.
3. At the start time the **workout starts for everyone at once**. Interval boundaries happen on the same second on every screen, from the same clock, whoever joined when.
4. All the way through, everyone sees everyone's video, hears anyone not muted, and sees each rider's power, heart rate and cadence. Some of those are charted, some are just numbers.
5. When the workout ends, everyone drops into **cooldown**: the same free mode as warmup. People ride and talk for as long as they like and leave when they want.

**The workout is fixed once the ride is created.** Nobody, host included, can change it, extend an interval or skip one during the ride. That keeps the schedule a constant every client can hold on its own (see Durability).

## The pieces

```
                 ┌──────────────────────── Cloudflare ────────────────────────┐
                 │                                                            │
  Browser (Auuki)│  Pages (auuki.d3-mi.com)                                   │
  ┌────────────┐ │  ┌──────────────────────────────┐                          │
  │ watch.js   │ │  │ functions/api/group/…        │   ┌────────────────────┐ │
  │ + group    │─┼─▶│  POST   /api/group  create   │──▶│ D1 `auuki`         │ │
  │   clock    │ │  │  GET    /api/group/:id       │   │ group_rides,       │ │
  │ + group    │ │  │  GET    /api/group/:id/ws ───┼─┐ │ group_riders       │ │
  │   panel    │ │  │  POST   /api/group/:id/media │ │ └────────────────────┘ │
  └─────┬──────┘ │  └──────────────────────────────┘ │                        │
        │        │                                   ▼                        │
        │ WS     │  Worker `auuki-group`  ┌───────────────────────────────┐   │
        └────────┼───────────────────────▶│ Durable Object GroupRide      │   │
   stats 1 Hz up │                        │ one per ride: schedule,       │   │
   roster+stats  │                        │ roster, clock, last 10 min of │   │
   1 Hz down     │                        │ everyone's samples            │   │
                 │                        └───────────────────────────────┘   │
                 └────────────────────────────────────────────────────────────┘
        │
        │ WebRTC (audio/video only), token from /api/group/:id/media
        ▼
   Cloudflare RealtimeKit (hosted SFU; LiveKit Cloud as fallback)
```

Three channels, deliberately separate:

| Channel | Carries | Why it's separate |
|---|---|---|
| **Pages Functions + D1** | creating a ride, the invite, the ride's record afterwards | plain request/response; D1 is already bound (`DB`) |
| **Durable Object over WebSocket** | the clock, the phase, the roster, everyone's 1 Hz stats | it is the source of truth for *when* things happen; it has to keep working when video doesn't |
| **Hosted SFU over WebRTC** | camera and mic | media is a solved, bandwidth-heavy problem; buy it |

If the video provider has a bad day, the ride still runs: intervals still change together and the numbers still flow. If a rider's camera dies, they're still in the ride.

## Why a Durable Object for the "mini server"

The site is already Cloudflare Pages + Functions + D1. A Durable Object is the Cloudflare version of "a tiny stateful server for one room":

- **One instance per ride**, addressed by ride id (`env.GROUP.idFromName(rideId)`), so every rider's WebSocket lands on the same object, in one place, single-threaded. No pub/sub, no Redis.
- **WebSocket Hibernation** means an idle lobby (people connected 15 minutes early, nothing changing) costs next to nothing.
- **Alarms** let it wake itself at the start time and the end time to announce the phase change, even if no messages arrive. (Clients don't depend on these; see Time.)
- **Transactional storage** keeps the schedule and roster safe across evictions and deploys.

Pages Functions can't define a Durable Object class, so it lives in a small separate Worker (`workers/group/`, deployed as `auuki-group`) and the Pages project binds to it:

```toml
# wrangler.toml (Pages)
[[durable_objects.bindings]]
name = "GROUP"
class_name = "GroupRide"
script_name = "auuki-group"
```

The Pages Function at `/api/group/:id/ws` checks the join token and passes the upgrade request to `env.GROUP.get(id).fetch(request)`. The browser only ever talks to `auuki.d3-mi.com`.

## Time: the part that has to be right

### Today

`watch.js` counts. A Web Worker (`timer.js`) posts a tick every second and the watch decrements `stepTime` / `lapTime` and steps forward when it hits zero. Pausing stops the ticks, `+5 min` stretches an interval, the lap button skips one. Two riders running this will drift apart: they start a second apart, a background tab's ticks get throttled, a pause shifts everything after it.

### In a group ride: position comes from the clock, not from counting

The schedule is fixed: `startAt` (epoch ms) and the workout's intervals. Where you are in the workout is a **pure function of the time**:

```js
// src/group/schedule.js — no state, no DOM, fully unit-testable
export function positionAt(schedule, serverNowMs) {
    const t = (serverNowMs - schedule.startAt) / 1000;   // seconds since start
    if(t < -schedule.lobbyS) return {phase: 'closed'};    // before the lobby opens
    if(t < 0)                return {phase: 'warmup', startsIn: -t};
    if(t >= schedule.durationS) return {phase: 'cooldown', since: t - schedule.durationS};
    // walk the intervals/steps (prefix sums, precomputed) to find where t lands
    return {phase: 'workout', intervalIndex, stepIndex, stepLeft, intervalLeft, workoutSecond: t};
}
```

In group mode the watch keeps its 1 s tick for *recording* (elapsed, laps, the FIT), but on every tick it asks `positionAt(schedule, clock.now())` and dispatches `watch:intervalIndex`, `watch:stepIndex`, `watch:stepTime`, `watch:lapTime` from the answer instead of decrementing. Everything downstream (targets, the workout graph, Time Left, beeps, the end screen's plan) keeps reading the same `db:` values it reads today.

That one change makes the hard cases fall out for free:

| Case | Result |
|---|---|
| Background tab, throttled ticks | the next tick reads the clock and lands on the right second |
| Join late (5 minutes in) | `positionAt` puts you in interval 3, 40 s left, like everyone else |
| Reload mid-ride | same; the ride restore already brings back the recording |
| Pause (manual or auto) | **your recording pauses; the group's workout doesn't**. Resume and you're wherever the group is now |
| `+5 min`, lap skip | off in group mode, for everyone including the host |

To make the interval change feel simultaneous, tick on the second boundary rather than 1 s after whenever the timer happened to start: the worker aligns its first tick with `setTimeout(… , 1000 - (clock.now() - startAt) % 1000)`. The 4-second countdown beep then sounds on the same beat in every room.

### The shared clock

Browsers' clocks can be seconds apart, so every rider uses **server time**, estimated over the WebSocket the way NTP does it:

1. Client sends `{type:'ping', t0: performance-based now}`.
2. The DO answers `{type:'pong', t0, server: Date.now()}`.
3. On receipt at `t1`: `rtt = t1 - t0`, `offset = server + rtt/2 - t1`.
4. Do 5 pings on connect, keep the offset from the one with the lowest RTT; one ping every 30 s after that, smoothed.

`clock.now() = performance.timeOrigin + performance.now() + offset` (`performance.now()` because it's monotonic; the wall clock can be stepped by the OS). Expected accuracy is tens of milliseconds, which is far tighter than the 1 s resolution the workout has.

Nobody waits to be told a phase has changed: each computes the phase from the same schedule and the same clock, so the switch happens locally on the second. The DO's `phase` broadcast (fired by its alarms) is a confirmation and a fallback for clients whose maths disagrees.

## Phases and what each rider's app does

```
  T−15 min            T0                              T0 + workout          rider leaves
     │   WARMUP        │          WORKOUT               │   COOLDOWN             │
     │ free ERG /      │ the workout drives ERG targets │ free ERG / resistance  │
     │ resistance      │ (each rider's own FTP)         │ ride as long as you    │
     │ countdown to T0 │ intervals change together      │ like                   │
     ├─────────────────┼────────────────────────────────┼────────────────────────┤
     │   one recording, from join to leave, with a lap at T0 and one at the end │
```

- **Warmup and cooldown** are the app as it is with no workout running: the ERG target control (or Resistance, if Settings has it on). Entering cooldown does what `workout:done` already does today — the mode change and the lap — but leaves the watch running instead of ending the ride. At T0 the app sets the workout's first target; it uses the existing 20 s ramp-in so nobody hits a wall.
- **The workout** is the host's workout, loaded into `db.workout` as it is from the library today. Targets are **% of each rider's own FTP**, so the same plan is right for everyone. Workout % (intensity) and Power Match stay personal and keep working.
- **One recording per rider**: warmup, workout and cooldown in a single FIT, with laps at T0, every interval, and the end. It saves through the existing end screen when the rider presses End. The end screen's image uses the workout portion.

## Stats: what goes up, what comes down

### Up: each rider, once a second

The app already builds exactly this row in `live-samples.js`; group mode sends the latest one over the WebSocket:

```json
{"type":"s","t":1763412345000,"w":312,"hr":164,"cad":94,"tgt":310,"ftp":285,"iv":3,"st":0,"st8":"r"}
```

`t` is server time, `st8` is the rider's own state (`r` riding, `p` paused, `c` coasting). About 100 bytes.

### Down: the DO batches, once a second

Relaying every message to every rider would be N² messages. Instead the DO keeps the latest sample per rider and broadcasts **one** snapshot of all of them at most once a second: when a sample arrives and the last broadcast was 1 s or more ago, it sends one. No per-second alarm or timer, so nothing keeps the object busy that the riders' own messages don't:

```json
{"type":"tick","server":1763412346000,"phase":"workout",
 "riders":{"r_8f2c":{"w":312,"hr":164,"cad":94,"tgt":310,"ftp":285,"st8":"r","age":0.4},
           "r_19ab":{"w":288,"hr":171,"cad":88,"tgt":276,"ftp":255,"st8":"r","age":0.7}}}
```

For 10 riders that's 10 messages in and 10 out per second, under 2 KB each — trivial for a DO.

- **Stale** — `age` over 5 s greys that rider's numbers; over 30 s shows "reconnecting".
- **History** — the DO keeps each rider's last 10 minutes (600 rows × 10 riders, fine in memory). A rider who joins or reloads gets it in the `welcome`, so their charts of everyone else aren't empty.
- **Privacy** — riders only send what they choose. Heart rate and FTP each get a "share" toggle on the join screen (on by default for the household).

### What's charted and what isn't

Per rider tile, under their video:

| Stat | Shown as | Why |
|---|---|---|
| Power (3 s avg) | big number **and** a sparkline over their target, the last 2 min | the thing you compare in a group ride |
| % of target / % FTP | small, coloured by zone | comparable across different FTPs; makes "who's suffering" readable |
| Heart rate | number and a thin line on the same sparkline (own scale) | drift over the intervals is the interesting part |
| Cadence | number only | jumpy; a chart of it is noise |
| State | badge (paused, coasting, reconnecting) | |

Plus one **group chart** above the tiles: everyone's % of target over the workout's blocks, one line per rider, so the room sees the whole interval at a glance. It reuses `live-chart.js`'s drawing with a second data source.

## Joining, links and who's allowed in

The site sits behind Cloudflare Access for the household, and guests won't have Access accounts. So:

- **Creating** a ride stays behind Access (`POST /api/group` sees `Cf-Access-Authenticated-User-Email`, the host is recorded).
- **The invite link** is `https://auuki.d3-mi.com/g/<rideId>#<joinKey>`. `joinKey` is random (128 bits), generated at create time and stored hashed in D1. The fragment never reaches server logs.
- **An Access Bypass policy** on just the paths a guest needs: `/g/*`, `/api/group/*` and the static app bundle. Every one of those endpoints checks the join key itself. Household members still arrive with their Access identity and get it as their name.
- **Joining** asks for a display name (remembered), which devices are connected, and the share toggles. The server gives back a **rider id** and a short-lived **session token** (HMAC-signed `{rideId, riderId, exp}` with a Pages secret), used for the WebSocket and the media token.
- **The lobby window** is enforced in the DO: a join earlier than `startAt − 15 min` gets `{phase:'closed', opensAt}`, and the page counts down to it.
- The host can **remove** a rider (closes their socket, revokes their media token) and **close** the ride.

## Media

### Provider

**Recommendation: Cloudflare RealtimeKit**, behind a thin adapter (`src/group/media.js`) so it can be swapped.

- A video-call SDK (rooms, mute state, speaker detection, simulcast, its own reconnection) on Cloudflare's SFU, so you aren't building track negotiation.
- Same account, same bill, same dashboard as the rest of Auuki. One fewer vendor to go down or change terms.
- Cheapest by a long way at this size (see Cost): 10,000 participant-minutes a month are included on every account.
- The Pages Function `POST /api/group/:id/media` creates the meeting once per ride and adds each rider as a participant with the RealtimeKit API, using a Cloudflare API token stored as a Pages secret (like `HA_TOKEN` today); the browser gets only that rider's auth token.

**Fallback: LiveKit Cloud.** The more mature SDK (adaptive stream, very good simulcast handling) and an open-source server you could self-host. Its free plan covers only two or three 10-person rides a month before you'd need the $50/month plan. If RealtimeKit's SDK turns out rough in step 4, switching means rewriting only `media.js`.

**Later, if it ever matters: Cloudflare's raw SFU.** It bills only egress, with the first 1,000 GB a month free, so it would cost nothing here. The catch is doing track negotiation and simulcast layer choice yourself, with the DO as the signalling server. Not worth it at $0–2 a ride.

Peer-to-peer mesh (no SFU) is out: at 6+ riders every laptop is uploading its camera 5+ times.

### Settings that matter on a trainer

- **Join muted** with push-to-talk (space bar) and a toggle; fans and freewheels are loud. Browser `noiseSuppression` and `echoCancellation` on.
- **Video**: publish 3 simulcast layers (720p / 360p / 180p); grid tiles subscribe to 180p at 15 fps, the active speaker or a pinned rider to 720p. Stop pulling video for tiles off-screen.
- **Bandwidth fallback**: under a bad connection the adapter drops to audio-only and shows avatars; stats keep flowing over the WebSocket regardless.
- The rider's ride **never depends on media**: if the SFU fails to connect, a banner says so and the workout carries on.

## The Durable Object

```
GroupRide (one per ride)
  storage:  schedule {rideId, title, workout, startAt, durationS, lobbyS, hostRiderId, closed}
            roster   {riderId → {name, joinedAt, leftAt, share:{hr, ftp}}}
  memory:   sockets  (hibernatable; riderId in the attachment)
            latest   {riderId → last sample}
            history  {riderId → ring buffer, 600 rows}
  alarms:   lobby open (T−15) · start (T0) · end (T0 + duration)
            · close (cooldown with nobody connected for 10 min → write the record to D1, shut down)
  no timers: the 1 s broadcast is driven by incoming samples
```

### Protocol (JSON over one WebSocket)

| Direction | Type | Body |
|---|---|---|
| C → S | `hello` | session token, plus your last 10 min of samples (rebuilds the DO's history after a restart) |
| S → C | `welcome` | schedule, roster, your riderId, server time, history |
| C ↔ S | `ping` / `pong` | clock sync (above) |
| C → S | `s` | your 1 Hz sample |
| S → C | `tick` | everyone's latest, phase, server time |
| S → C | `roster` | someone joined / left / was removed / muted |
| S → C | `phase` | `warmup` → `workout` → `cooldown`, with the server time it happened |
| C → S | `react` | 👍 🔥 (optional; a burst shown on that rider's tile) |
| host → S | `kick`, `close` | host controls (nothing touches the workout) |

Every message has a `v` (protocol version), so an old cached app (the service worker) gets a "please reload" instead of misbehaving.

## Cost

Prices as published in November 2026 ([RealtimeKit](https://developers.cloudflare.com/realtime/realtimekit/pricing/), [Realtime SFU](https://developers.cloudflare.com/realtime/sfu/pricing/), [LiveKit](https://livekit.com/pricing), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)).

**Assumptions for one ride:** 15 min warmup + 60 min workout + 15 min cooldown = **90 min per rider**. Video is a grid of 180p tiles (~150 kbps each) plus one 720p tile for whoever is talking (~1.5 Mbps), with most people muted. Each rider then *receives* about 2.8 Mbps with 10 people and 1.9 Mbps with 5. The bandwidth figures are estimates; measure them in step 4.

| Per ride | 5 riders | 10 riders |
|---|---|---|
| Participant-minutes | 450 | 900 |
| Video sent to riders (SFU egress) | ~6.5 GB | ~19 GB |
| Durable Object: billed requests (incoming messages ÷ 20) | ~1,400 | ~2,700 |
| Durable Object: duration (128 MB × 90 min) | ~340 GB-s | ~675 GB-s |

**What that costs:**

| Provider | Included each month | A 10-rider ride beyond that | Weekly 10-rider ride (4/month) |
|---|---|---|---|
| **Cloudflare RealtimeKit** (recommended) | 10,000 participant-minutes on every account: ~11 ten-rider or ~22 five-rider rides | 900 min × $0.002 = **$1.80** ($0.90 for 5 riders) | **$0** |
| LiveKit Cloud, free (Build) | 5,000 min and 50 GB: bandwidth runs out first, after ~2 ten-rider rides | no overage price listed; you'd move to Ship | doesn't fit (~76 GB) |
| LiveKit Cloud, Ship ($50/mo) | 150,000 min and 250 GB: ~13 ten-rider rides | ~$2.30 bandwidth + $0.45 minutes ≈ **$2.75** | **$50** |
| Cloudflare raw SFU (no SDK) | 1,000 GB egress: ~50 ten-rider rides | 19 GB × $0.05 = **$0.95** | **$0** |

The RealtimeKit page doesn't say whether SFU egress is billed on top of the minutes. If it is, 19 GB a ride sits well inside the 1,000 GB a month that Realtime gives every account.

**The server costs nothing at this size.** One ride is ~2,700 billed requests and ~675 GB-s. The Workers free plan allows 100,000 requests and 13,000 GB-s **a day**; the $5 paid plan includes 1 million requests and 400,000 GB-s a month. D1 and Pages Functions use is a few dozen rows and requests per ride.

**Bottom line:** with RealtimeKit, a weekly 5–10 person ride is **free**. Past ~11 ten-rider rides in a month it's about **$1.80 a ride**.

## Durability

The worry is the one server every rider is connected to. The design's answer: **make that server something the ride can lose for minutes at a time without anyone's workout noticing**, then make it come back cleanly.

### 1. The server is not on the workout's critical path

Everything a rider needs to stay in sync, they hold locally after the first `welcome`:

- **The schedule**: the frozen workout and `startAt`. It's written to IndexedDB next to the ride backup, so it survives a reload with the server down.
- **The clock offset**, which drifts by milliseconds per hour; a reload keeps the last good one.
- **`positionAt()`**, which is pure local maths.

So if the WebSocket drops at minute 23, every rider's intervals still change on the same second, ERG targets still change, beeps still sound, and every recording still saves. **What's lost while it's down is only other people's numbers**, which grey out with "reconnecting". The same goes in the other direction: if video drops, the stats and the workout carry on.

This is the reason the workout can't change mid-ride. A constant schedule means no client ever needs the server to tell it what's next.

| What fails | What riders notice |
|---|---|
| A rider's Wi-Fi blips | their own tiles of others go grey for a few seconds, then refill from history |
| The DO restarts (deploy, Cloudflare moves it, a crash) | everyone's tiles grey for 1–5 s while sockets reconnect; workout unaffected |
| The DO is unreachable for minutes | as above, longer; workout unaffected; video and audio unaffected |
| RealtimeKit has an outage | no video or audio; workout and stats unaffected |
| A rider reloads mid-interval | back in the same interval at the same second; ride restore brings back their recording |

### 2. The server keeps almost nothing that can't be rebuilt

- **Durable state** (in the DO's storage, and in D1): the schedule and the roster. Small, written rarely, transactional.
- **Memory only**: the latest sample per rider and the 10-minute history. If the object restarts, these are rebuilt **from the clients**. On reconnect each rider sends `hello` with their last 10 minutes from `live-samples.js`, which they already keep. A restart loses nothing anyone can see.
- **No timers in memory.** The 1 s broadcast is driven by incoming samples, and the phase alarms are stored alarms, which survive restarts and retry on failure. Nothing depends on a `setInterval` surviving.

### 3. Reconnecting is a normal event, not an error path

The client treats the socket as something that will drop, and recovers by itself:

- **Detecting a dead socket**: browsers can take minutes to notice a half-open TCP connection. So the client watches for `tick`s: no `tick` for 3 s while others are riding (or no `pong` for 10 s in the lobby) means close and reconnect, without waiting for the browser.
- **Backoff with jitter**: 0.5 s, 1 s, 2 s, 4 s, then every 10 s, each ±30%, so ten riders don't all retry at the same instant after a restart.
- **Resuming**: the session token is reusable for the whole ride, so a reconnect is just `hello` again. The roster keeps the rider's id, so their tile stays where it was rather than leaving and re-joining.
- **The session token outlives the server**: it's checked with an HMAC secret, so a reconnect needs no lookup that could fail.
- Reconnects, close codes and gaps go to the existing debug traces (D1 `auuki`), so after a ride `scripts/traces.mjs` shows exactly what dropped and for how long.

### 4. Deploys can't break a ride

Deploys are the most likely cause of a restart, and the one you control.

- **The DO Worker is separate and small** (`auuki-group`). Deploying the app (Pages) never touches it, and the protocol is versioned so an old object and a new app still talk.
- Cloudflare now defers a DO's code update until the object hibernates (up to 5 minutes, best effort). **During a ride it won't hibernate**, because samples arrive every second, so an update is forced at the end of that window and disconnects everyone. Rather than rely on that, **the deploy script for `auuki-group` refuses to run while any ride is in its window** (lobby open through 2 h after the end), checked in D1. Override with `--force`.
- Even a forced restart mid-ride is the "DO restarts" row in the table above: a few seconds of grey tiles.

### 5. One object is plenty

10 riders × 1 message a second is 10 messages in and 10 broadcasts out per second. Cloudflare's docs say a single object serves thousands of connections; this is three orders of magnitude below that. The object is created in the data centre closest to whoever opens the ride first. A rider across the country gets maybe 60–80 ms more latency, which doesn't matter for 1 s stats, and the clock sync measures and cancels it.

### 6. Testing it

Durability gets its own tests in build step 1, before any UI polish:

- **Unit**: `positionAt()` over every boundary, late joins and clock offsets (Jest, like the rest of `test/`).
- **Chaos, with Playwright and 5 headless riders** against `wrangler dev`: kill one rider's socket, kill all of them, restart the DO mid-interval, skew one rider's clock by 10 s, throttle a tab to background rates. Pass condition: every rider's interval index changes within 100 ms of the others', and every rider's stats tiles recover within 5 s.

### What's still a real risk

- **A Cloudflare-wide incident.** It would take Access, Pages and the DO together; there's no sensible way to hedge that at household scale. Riders who already loaded the page keep riding in sync on their cached schedule.
- **Join failures right at T0.** A rider who has never connected has no schedule. Opening the lobby 15 minutes early gives slack, and the join page retries until it has the schedule.
- **Bugs in our own code** in the DO are more likely than Cloudflare failing. Keep the DO dumb (relay, roster, schedule, nothing clever) and keep the clever parts in `schedule.js`, which is pure and unit-tested.

## Storage (D1)

```sql
CREATE TABLE group_rides (
    id          TEXT PRIMARY KEY,     -- short, URL-safe
    title       TEXT,
    workout     TEXT NOT NULL,        -- the workout JSON, frozen at create time
    start_at    INTEGER NOT NULL,     -- ms
    duration_s  INTEGER NOT NULL,
    host        TEXT,                 -- Access email
    join_hash   TEXT NOT NULL,        -- sha-256 of the join key
    created     INTEGER,
    closed      INTEGER
);
CREATE TABLE group_riders (
    ride_id     TEXT NOT NULL,
    rider_id    TEXT NOT NULL,
    name        TEXT,
    joined      INTEGER,
    left        INTEGER,
    avg_w INTEGER, np_w INTEGER, avg_hr INTEGER, kj INTEGER,  -- the workout portion
    PRIMARY KEY (ride_id, rider_id)
);
```

The workout is **frozen into the ride** at create time, so editing it in the library or on intervals.icu afterwards can't put riders on different plans. Each rider's full ride is still their own FIT, saved and uploaded as today; D1 only keeps the group's summary (for a "past group rides" list and a results card).

## Where it goes in the repo

```
workers/group/                  the Durable Object Worker (its own wrangler.toml, deployed as auuki-group)
  index.js                        GroupRide class
functions/api/group/
  index.js                        POST create (Access only)
  [id].js                         GET ride info for the join page (join key checked)
  [id]/join.js                    POST join → riderId + session token
  [id]/ws.js                      WebSocket upgrade → the DO
  [id]/media.js                   POST → media token
src/group/
  schedule.js                     positionAt(): pure, the heart of the sync; heavily unit-tested
  clock.js                        server-time offset over the socket
  connection.js                   the WebSocket: reconnect with backoff, hello/welcome, send samples
  group.js                        group mode: wires schedule + clock into watch.js, owns phases
  media.js                        the provider adapter (connect, publish, subscribe, mute)
src/views/
  group-join.js                   name, devices, share toggles, countdown to the lobby
  group-panel.js                  video grid with stat tiles, the group chart, mute/camera controls
  group-create.js                 pick a workout + time, copy the link
schema.sql                        + the two tables
```

**Changes to existing code**, kept small:

- `watch.js` — a `groupMode` flag. When set: `onTick` takes the position from `group.js` instead of decrementing; `+5 min` and lap skip are disabled; `workout:done` leads into cooldown instead of stopping; auto-pause still pauses the *recording* only.
- `timer.js` — accept an aligning first delay so ticks land on the second boundary.
- `live-samples.js` — no change; `group.js` reads `liveSamples.latest`.
- `live-chart.js` — accept a sample source, so the group chart can reuse it.
- `sw.js` — never cache `/api/group/*`.

## Build order

1. **Shared clock and schedule, no video.** `schedule.js` + tests, the DO with `hello`/`welcome`/`ping`/`phase`, `groupMode` in the watch. Test: two browsers (or one with a faked clock offset) change intervals on the same second, through a reload and a late join.
2. **Stats.** Samples up, `tick` down, simple tiles with numbers. Then the sparklines and the group chart.
3. **Links and guests.** Create page, join page, join key, Access bypass on the group paths, session tokens.
4. **Media.** RealtimeKit adapter, grid, mute/push-to-talk, simulcast, audio-only fallback.
5. **Polish.** Results in D1 and a results card, reactions, the host's controls.

Steps 1–2 are the risky, Auuki-specific part; 4 is mostly SDK wiring.

## Risks and open questions

- **Rider's machine load.** Video grid + Web Bluetooth + ERG control on one laptop. Keep subscribed video to 180p and few tiles at full rate; measure CPU on the weakest machine early.
- **Bluetooth glitches look like dropouts.** Already handled locally (power reads 0 after 2 s quiet); the tile shows "coasting" rather than a scary 0.
- **Different FTPs / Workout %.** Targets are per rider; the group chart shows % of target so it compares fairly. Showing absolute watts to others is a share setting.
- **What does "everyone" mean for a 50-person ride?** The design holds to ~20; beyond that the grid needs paging/active-speaker-only and the DO tick should send diffs. Not a v1 concern.
