<img alt="Auuki Indoor Cyling app for Structured Training" src="https://github.com/user-attachments/assets/292a3216-2f52-4994-9b15-614446e41912" />

# pERGatory (lukedemi/Auuki)

**pERGatory** is this fork's name since Nov 18, 2026 (it was ERGatory from Nov 17, at ergatory.d3-mi.com; rider's call both times; "Auuki" stays for the upstream project, credited in Settings → About). It is built in two flavours from the same code (`src/flavor.js`):

| | Household | Public |
|---|---|---|
| Address | **auuki.d3-mi.com** (kept: a browser keeps rides, settings and paired-device permissions per address) | **pergatory.d3-mi.com** |
| Access | Cloudflare Access, `household` group plus named guests | open to anyone; Access guards only the household's paths (below) |
| Pages project | `auuki` (with `functions/`, D1 `auuki`, the HA secrets) | `pergatory`: the same `functions/`, D1 and group Worker, its own HA token, the Strava secrets |
| Extras | the trainer room from Home Assistant, debug traces, hosting group rides | the same, **for a browser signed in to the household**; **Strava** (Connect with Strava) is here only |
| Build | `npm run release` → `dist/` | `npm run release:public` → `dist-public/` |
| Source offered | `source.tar.gz`, the whole repository | `source.tar.gz`, what builds and runs it (src/, functions/, the group Worker, build config, licence) |

Both offer their source at `./source.tar.gz` (Settings → About), as the AGPL's section 13 asks of a network service; `scripts/source.mjs` packages the commit being released and refuses an uncommitted `src/`. Internal identifiers that rides and settings depend on stay as they were: the upload external ids (`auuki-<id>` on intervals.icu, `ergatory-<id>` on Strava) and the upstream localStorage and IndexedDB keys. The app's own keys are `pergatory:*`.

**The household on pergatory.d3-mi.com** (rider, Nov 17, 2026: *"how can it know it's me and have all my fancy flags without us running a separate website"*). One Access app, *pERGatory (household paths)*, covers `pergatory.d3-mi.com/api/me`, `/api/room`, `/api/trace`, `/api/host` and `/household` for the `household` group (720 h session); the rest of the site is public. Settings → Household → *Household sign-in* goes to `/household`, which Access gates and which sends the browser back to `/?household=1` (`functions/household.js`). The app then asks `/api/me` (`src/household.js`): a 200 means household, and the room, the traces and hosting group rides switch on; anything else (Access answers an anonymous fetch with a login redirect) reads as no, silently. The functions behind those paths check `cf-access-jwt-assertion` themselves too, so a path left out of the Access app fails closed.

**Moving from auuki.d3-mi.com** (`src/transfer.js`): the first time a household browser signs in on pergatory, it opens auuki.d3-mi.com/transfer.html in a hidden frame (same site, so the frame has auuki's own storage and Access cookie). That page answers pergatory's origin only, with every localStorage setting (the intervals.icu key, FTP, sources, Power Match…) and the saved rides and workouts. Settings overwrite, rides and workouts are added where missing, and the page reloads. Not moved: Bluetooth pairings (Chrome grants those per site) and pergatory's own keys (`pergatory:*`). Settings → Household → *Bring over from auuki.d3-mi.com* runs it again.

**Moving from ergatory.d3-mi.com** (rider, Nov 18, 2026: *"move the domain over and add the redirect"*). ergatory.d3-mi.com is a second custom domain on the `pergatory` project, and `functions/_middleware.js` sends every page there to the same path on pergatory.d3-mi.com (302), except `/transfer.html`; scripts, images and the API are still served. On a browser's first visit to pergatory, before any sign-in, the app opens ergatory.d3-mi.com/transfer.html in a hidden frame and brings that browser's settings, rides, workouts and **Strava connection** over the same way (`ergatory:*` keys renamed `pergatory:*`; the tokens are the rider's, not the address's, so nobody reconnects). Strava's callback domain is pergatory.d3-mi.com. The old `ergatory` Pages project is kept, serving only `ergatory.pages.dev`.

Deploy the public one from a folder holding its build, the functions and a `wrangler.toml` naming the `pergatory` project:

```bash
npm run release:public
rm -rf /tmp/pergatory-public && mkdir -p /tmp/pergatory-public && cp -r dist-public /tmp/pergatory-public/site && cp -r functions /tmp/pergatory-public/
sed -e 's/^name = "auuki"/name = "pergatory"/' -e 's/^pages_build_output_dir = "dist"/pages_build_output_dir = "site"/' wrangler.toml > /tmp/pergatory-public/wrangler.toml
cd /tmp/pergatory-public && python3 ~/homeassistant/scripts/cf-pages site --name pergatory --domain pergatory.d3-mi.com --public
```

Changes on top of upstream:

- **Power Match** (`src/power-match.js`): with the Power source set to the Bluetooth power meter, ERG holds the *meter's* reading on the target instead of the trainer's. It learns the meter/trainer ratio from both live streams and sends the trainer `target / ratio`. Settings → Power Match (on by default); the power meter card's Match tile shows the live offset. **It settles into long intervals**: for the first minute at a target it corrects every 3 s on a 20 s average, and by ten minutes it has eased to a 120 s average, a correction only when it is worth 2% of the target (at most every 30 s), and smaller ones (2 W+) every 90 s, so a long interval is not chased but still closes. A new target resets it. The debug panel shows `steady` and `calm`. **A new interval holds the calibration**: for 15 s after a target change of 10 W+, nothing is learned and nothing corrected (the trainer is catching up and the rider spinning up, so the two meters disagree for reasons unrelated to calibration); the new target goes out with the ratio already known, and a step up of 30 W+ ramps in over 5 s instead of landing as a wall. The debug panel and the log carry `hold`.
- **intervals.icu, direct** (`src/models/intervals-direct.js`): upstream reaches intervals.icu through api.auuki.com, a closed backend; here the browser talks to the intervals.icu API itself with the athlete's API key (Settings → Intervals.icu, stored in that browser only). The Planned list shows the week's rides from the intervals.icu calendar as .zwo (strength sessions filtered out), FTP and weight come from intervals.icu, and the intervals.icu button on a saved activity uploads the .fit (with an `external_id`, so a repeat upload is a no-op). Off auuki.com the Auuki account backend is skipped entirely.
- **Live charts**: the Graph panel on the home page is a live chart (it was the Moxy strip, a 1 px-a-second line on a 0–600 W scale, now hidden): your power over the workout's targets as zone-coloured blocks, heart rate on its own scale, over a window you tap through 2 min · 10 min · 30 min · Ride, with the window's average power and heart rate. The workout graph also draws your actual power over the planned blocks as you ride. Both read one buffer, `src/live-samples.js`: a sample a second while the timer runs.
- **Power Match Debug**: Settings → Power Match Debug, or `?debug` in the URL, opens an overlay with both readings, the ratio, the target against what the trainer was sent, a CSV log of every sample (`csv`), and a no-hardware simulator (`sim`, with the meter/trainer ratio to fake). `window.powerMatch` in the console. `/version.json` names the deployed commit.

- **A ride survives a reload**: the ride in progress is saved to IndexedDB in one-minute chunks every 15 s and on pause (upstream saved it only on page close, which a killed tab never reaches). After a reload it comes back paused, with a *Ride restored* notice and the live charts refilled; pedal or press ▶ to carry on.
- **Devices reconnect on load**: the last trainer, power meter and heart-rate strap that connected are remembered and reconnected without the chooser (Settings → Reconnect Devices). It needs Chrome to remember Web Bluetooth permissions across reloads; the traces' `page:load` row says whether `getDevices` exists in that browser. Tapping a device while it is being waited for opens the chooser instead.
- **+5 min on an interval**: a *+5 min* button by Interval Left (and the + / = key) adds five minutes to the interval being ridden, as often as pressed. The time goes on the interval's last step, so a cool-down ramp finishes and then holds its last power; the clocks, Time Left, Finish and the workout graph follow, the library's workout is untouched, and a reload keeps the longer ride.
- **Paused is unmissable**: a pulsing amber frame round the screen, a big PAUSED banner over the charts (tap it to resume) and "⏸ Paused" in the tab title. Pedalling over 40 W while paused turns it red and counts down; after 5 s the ride resumes, a manual pause included (with Auto Pause on), so it is no longer possible to grind on unrecorded.
- **Auto-pause and easing back in**: power reads 0 once the sensors go quiet for 2 s (it used to stick at the last value, on screen and in the file), and auto-pause fires after 3 s under 20 W (it needed four readings of exactly 0). Paused, the trainer holds 100 W (or the target, if lower) instead of the interval's watts, and on resume, or at the start, it ramps back to the target over 20 s.
- **Debug traces**: every page load sends what it is doing to D1 `auuki` through `functions/api/trace.js` every 10 s (Settings → Send Debug Traces): state once a second while riding, device and watch events, power-match corrections, the console and every error. `window.trace.mark('…')` or the debug panel's **mark** button drops a marker. Read them, live with `--follow`:

```bash
node scripts/traces.mjs                          # the latest sessions
node scripts/traces.mjs latest --kind event,error,mark --since 30m --follow
```

- **Workout intensity**: beside the ERG target, *Workout %* scales every power target in the workout, 1% a press (50–150%), built exactly like the target control (type a value too; *reset* goes back to 100%). **Up / Down arrows move the Workout %**; Shift + Up / Down move the target 5 W. A change rescales the current target by the ratio, so a nudge on this interval survives it. The ERG target itself moves 5 W a press (was 10).
- **Interval beeps you can hear**: the volume starts at 50 (upstream shipped at 0, so the 4-second countdown into each interval was silent), audio unlocks on the first touch or key press (an auto-started ride has none), and changing the volume plays a blip at the new level.

- **L/R balance**: a two-sided meter (Assioma Duo pairs as one Bluetooth device, the left pedal speaking for both, so its power is already the total) sends the left's share with every power reading; it goes into the FIT as standard `left_right_balance` (the right's % with bit 7 set, as an Edge writes it), the power meter card's L/R tile, the live chart's window average (power-weighted, coasting left out) and the traces.
- **Units**: imperial by default (a stored choice wins), the units on the Speed and Distance tiles, distance always in mi or km, and the virtual speed now uses the rider's weight (it stayed at an 85 kg default).

- **ERG only**: the Resistance and Slope mode buttons (and the R / S keys) are off unless Settings → Resistance & Slope is on.
- **Numbers as big as their tiles** (`src/views/fit-text.js`, desktop only): each value is sized to fill its tile, measured with every digit as 0 so a ticking clock never changes size, and every row shares one size.
- **Desktop layout**: on a landscape screen 1200 x 650 or larger, the numbers stack in a column on the left (Power and Target, Interval Time, HR and Cadence, Power Lap and Elapsed, Time Left and Finish), the live chart and the workout graph take the rest, the ERG target and Workout % sit under them, and one bottom bar carries, left to right, the workout name, the connection switches (Controllable, Power Meter, HRM), Target W and Workout %, the watch and the menu: the top bar and the row under the charts are gone on desktop (with Settings → Resistance & Slope on, the targets keep their row, for the mode buttons). The rules are the last block in `src/css/flux.css`; smaller screens keep upstream's layouts.
- **Work (kJ)** replaces Slope (always 0.0 in ERG): the ride's power summed second by second, with **TSS** so far small in its heading (NP from the 30 s rolling average, IF against the FTP set in the app). On desktop the column reads Power · Heart Rate / Cadence · Work / Elapsed · Time Left · Finish, and under it a **Lap** section with everything about the current interval: Interval Left and Target large, Power Lap and HR Lap.
- **The Workouts page on desktop** (`src/views/workout-detail.js`, the last block of `src/css/flux.css`): on the same desktop screens, the lists (Planned, Activities, Library) sit compact in a column on the left, each scrolling on its own, and the workout you click shows large on the right: its graph, time, TSS, IF, NP, kJ and how many intervals go over FTP at your FTP, time in each zone, the description, **Load** and **Load and ride**, and the group ride box for that workout. The editor puts the details beside the intervals. Phones keep the single column.
- **Time Left and Finish** replace Speed and Distance: what remains of the workout (the rest of this interval plus every one after it), and the clock time it will end, which slides later while paused (`src/views/time-left.js`).
- **Ending a ride** (`src/views/pause-overlay.js`, `src/views/ride-summary.js`): the pause screen carries **Resume** and **End workout** (tap twice; the second tap within 4 s ends it). Stopping saves the ride with no save button: the write is read back before it counts, the session backup is cleared only after that, and a write that does not read back downloads the .fit on the spot and keeps the backup. Ending a ride also disarms auto-start, so spinning on never starts a new one. The **end screen** then opens: the name, RPE (1–10), feel (1–5, 1 best, as intervals.icu has it) and notes, each written to the saved ride as it changes; the ride's image with Save image; Upload to intervals.icu; Download .fit. No Strava button: rides reach Strava through the bikes post-ride flow, and upstream's Strava upload needs its own backend. Once a ride is on intervals.icu (direct, with the API key) its name, RPE, feel and notes follow it there, on upload and on every later edit. The image button on any saved activity reopens its end screen.
- **Power Match picks whose power is shown** (`src/views/data-views.js` PowerMatchSetting): on, the pedals' power is shown and recorded and steers the trainer; off, the trainer's own reading is shown and recorded and the pedals play no part. A saved "off, pedals as source" state is put right on load.
- **Rides go to intervals.icu by themselves** (`src/auto-upload.js`): any ride saved in this browser that isn't there yet is sent when it ends, when its end screen closes, when the app loads, and again on a backing-off timer (1, 2, 5, 10, then every 20 min) when intervals.icu doesn't take it; quietly, no error box. Rides under 5 minutes and older than 3 days are skipped. One upload of a ride at a time (`models.js Activity.upload`), and the external id makes a repeat a no-op.
- **Workouts → Activities** (`src/views/activity-history.js`): its own tab beside Workouts, Editor and Ride report, every ride saved in this browser (100 kept, upstream kept 7), newest first, with when, how long, RPE and feel, and whether it's on intervals.icu. A click opens the ride's end screen, which now also has *Delete ride* (two taps). It replaced upstream's Activities list under Workouts.
- **Strava** (`src/models/strava-direct.js`, `src/views/strava-settings.js`, `functions/api/strava/[[path]].js`): Settings → Strava has Strava's own *Connect with Strava* button, straight to strava.com/oauth/authorize asking for `read,activity:write`, back to the site's root. The return is swapped for tokens by the relay with the app's secret (`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` as Pages secrets on the `ergatory` project only: anything Strava is the public pERGatory's, its callback domain is ergatory.d3-mi.com, and the household copy's Settings points there; the pERGatory Strava app is client 127032, the same app bikes posts through). The tokens stay in the rider's browser; the relay stores nothing and forwards only uploads, their status, activity edits, the athlete and deauthorize. A finished ride uploads with its name and notes (external id `ergatory-<id>`), from the end screen and by the background uploader for rides finished after connecting; edits follow it; *View on Strava* in #FC5200 per Strava's brand guidelines; Disconnect revokes at Strava. 
- **The pedals' crank length and zero** (`src/ble/cps/`, `src/views/pedal-settings.js`): Settings → Power Meter shows the crank length the pedals hold, read from them on every connect over the Bluetooth control point, sets it (110–200 mm by 2.5) and zeroes them (offset compensation; cranks level, feet off). Each control shows only when the pedals' feature flags offer it; otherwise it points to the Favero app. A pedal's power is force × this length, so a wrong one reads wrong in proportion (172.5 set on 145 mm cranks reads 19 % high).
- **Pedalling through a pause** (`src/pause-resume.js`): a pause you set yourself ends after 5 s of real pedalling, over 60 W and 40 rpm, and nothing in its first 6 s counts. Power meters hold their last reading for a few seconds after the cranks stop (the pedals reported ~95–118 W at 80 rpm for 4 s after a pause on Nov 17, 2026, and the ride resumed by itself), and feet drifting on the pedals make neither floor.
- **Numbers hold their size** (`src/views/fit-text.js`): a plain number is sized as at least three digits and a tile only ever widens what it reserves, so a heart rate going 99 → 100 moves nothing. Power had been setting its whole `style` for its colour on every reading, wiping its fitted size until the next refit (SmO2 and THb too); they set the colour alone now.
- **Reconnect, one click a device** (`src/views/device-reconnect.js`): Chrome reconnects to paired devices only through `navigator.bluetooth.getDevices()`, which on desktop needs chrome://flags/#enable-web-bluetooth-new-permissions-backend. With it, the remembered devices come back on load by themselves. Without it, a strip on the home screen offers a button per remembered device that isn't connected a few seconds after load, opening the picker narrowed to that device by name (`connectable.js connectByName`): one Pair each.
- **Finishing** (`src/views/ride-finished.js`): when a ride ends, the end screen opens with *Workout complete* and uploads to intervals.icu by itself (direct key set). Under it the home screen is closed: *Workout complete*, the completed rides in this browser (each opens its end screen, with its intervals.icu state), the trainer let go (ERG target 0), and the keys that start or steer a ride held. Only *Start a new ride* opens it again.
- **The trainer room** (`functions/api/room.js`, `src/room.js`, `src/views/room-status.js`): temperature, humidity, CO₂ and the two fans from Home Assistant, over the live chart (CO₂ amber from 1,000 ppm, red from 1,400), read every 30 s. The Pages Function asks HA's template API for every value in one call, so the browser holds no HA token and HA needs no CORS; it needs `HA_URL` and `HA_TOKEN` as secrets on the Pages project (`npx wrangler pages secret put HA_TOKEN --project-name auuki`), and without them the strip stays hidden. Temperature and humidity come from the room's own sensor first and the CO₂ unit's second (homeassistant `docs/SENSORS.md`). A log of the room, once a minute while the timer runs, is saved with the ride and summed up on the end screen.
- **The ride as an image** (`src/ride-card.js`): a 1600 x 1000 PNG for Strava, on the end screen, with no title, the headline numbers at the top; on the chart, besides power and heart rate, the extras as lines, each on its own scale with its last value at its end and only when the ride carries it: room temperature and CO₂ from Home Assistant, cadence (60 s means, a stop a gap), and a strip along the bottom while a fan was on; then the workout as written (the plan, at the ride's FTP) as zone-coloured blocks, a dashed line wherever the target set was off the plan (Workout %, a nudge), power and heart rate over them, the reps labelled, and time, NP, IF, TSS, kJ and average heart rate. A ride keeps its one-second power, heart rate, target set and planned watts on the activity record (the plan from the workout step running each second, so extensions and pauses stay aligned); one saved before that is read back from its FIT, the plan laid over its laps from the workout still loaded if it has the same name, else that day's planned workout of the same name on intervals.icu. Upstream left the button as a greyed placeholder.

- **Group rides** (`src/group/`, `src/views/group-views.js`, `workers/group/`; design in `doc/group-ride.md`): host one from the Workouts page with the workout that's loaded and a start time, and send the link. Riders can join from 15 minutes before the start and warm up however they like; at the start time the workout starts for everyone on the same second (the interval is worked out from a shared server clock, not counted, so a reload, a late join, a pause or a background tab all land where everyone else is); at the end everyone drops into cool-down, ERG free, for as long as they like. Everyone's video, mic (joined muted; **M** toggles) and numbers in place of the live chart: power with a 2-minute sparkline over their target, % of target by zone, heart rate (if shared) and cadence, and a group chart of everyone's % of target. The workout is fixed for the ride: no +5 min, no skipping. The server is a Durable Object per ride in its own Worker, `auuki-group`, reached through a service binding; it keeps no timing, so if it restarts or is unreachable the workout carries on and only other people's numbers go grey. Video is Cloudflare RealtimeKit (optional: without its secrets, rides run without video). `node --no-warnings scripts/group-chaos.mjs` rides 5 simulated riders with wrong clocks through cut sockets and a server restart.

Deploy (from `master`, by hand — nothing deploys on merge):

```bash
npm install
npm run release
python3 ../homeassistant/scripts/cf-pages dist --name auuki --domain auuki.d3-mi.com
```

`release` builds `dist/` and writes `dist/version.json`; `cf-pages` puts Access (the `household` group) in front of the project before uploading and checks the gate afterwards. Run it from this directory: wrangler picks up `functions/` and `wrangler.toml` (the D1 binding) from the working directory. The schema is `schema.sql` (`npx wrangler d1 execute auuki --remote --file schema.sql`).

Group rides need the `auuki-group` Worker deployed before the Pages project (its service binding names it), once with the schema applied and its secrets set:

```bash
cd workers/group && npm install
npx wrangler secret put TOKEN_SECRET          # any long random string
npx wrangler secret put RTK_ACCOUNT_ID        # video (optional): the Cloudflare account id,
npx wrangler secret put RTK_APP_ID            # the RealtimeKit app's id,
npx wrangler secret put RTK_API_TOKEN         # and an API token with Realtime edit rights
cd ../.. && node scripts/deploy-group.mjs     # refuses while a ride is on; --force overrides
```

Guests have no household login, so they get the same build from a second Pages project, **`auuki-ride`** (`https://ride.d3-mi.com`, also `auuki-ride.pages.dev`), which Access leaves open except `/api/room`, `/api/trace` and `/api/host` (household only, the "Auuki rides — household-only paths" Access app). It has no Home Assistant secrets. Pages applies a project's `pages.dev` Access app to its custom domains too, which is why guests can't simply have a bypassed hostname on `auuki`. Deploy the app to both:

```bash
npm run release
python3 ../homeassistant/scripts/cf-pages dist --name auuki --domain auuki.d3-mi.com
npx wrangler pages deploy dist --project-name auuki-ride --branch main
```

The group endpoints check the ride's join key themselves; the Worker's `GUEST_ORIGIN` is where guests' links point.

---

# Auuki
Auuki is a powerful, no-nonsense app built for hammering out **structured workouts** on a smart trainer, right in your browser. No installs, no dependencies, no slow updates taking from precious training time.

**Key Features**:
* Run Zwift **.ZWO workouts**
* Connect via **Bluetooth** to smart trainers, power meters, heart rate monitors, the moxy monitor, and many more
* Full control with **ERG mode**, **Grade Simulation**, and **Resistance mode**
* Workouts with **Slope-based targets** for realistic effort control
* Record **.FIT activities** in a cross-industry standard
* Recording of native **RR intervals** in the .FIT file
* Built-in structured workouts to get you started
* **Intervals.icu and Strava** integrations for seamless syncing and uploads

Built as a **progressive web app (PWA)**, Auuki is fully browser-based and runs independently. It makes use of some of the most advanced Browser APIs like: Web Bluetooth, Web Serial, and Web Components. The web version is **free and open-source**, keeping everything on your device.
Train anywhere, with full control directly in your browser.

_Status_: Currently working on creating a full suite of Apple platform native apps (iOS, iPadOS, tvOS, watchOS).

# The Web App
- You can find the web app at [auuki.com](https://auuki.com)
- There is also a special development version which has the latest features available for preview: [dev.auuki.com](https://dev.auuki.com)
- [How to create a Profile and Connect Intervals.icu](https://forum.intervals.icu/t/auuki-com-intervals-icu-integration/87105)

## Sponsors 💖
So, if you’re loving what Auuki’s bringing to the table, consider supporting the project on [GitHub Sponsors](https://github.com/sponsors/dvmarinoff)? Think of it as buying me a coffee or, heck, a whole power meter to keep this thing cranking. Hit that sponsor button and let’s keep the good times rolling!

## Supported Browsers and Platforms

### MacOS, Windows, Andorid 

Please use either Chrome, Edge, Opera, Samsung Internet, or Brave. These browsers include built-in bluetooth.

| Chrome | Edge | Opera | Chrome Android | Samsung Internet | Brave | Firefox | Safari | Safari iOS | Chrome iOS |
|--------|------|-------|----------------|------------------|-------|---------|--------|------------|------------|
| yes    | yes  | yes   | yes            | yes              | yes*  | no      | no     | no         | no         |

If using Brave browser, you'll need to [manually enable bluetooth support](https://community.brave.com/t/can-you-enable-web-bluetooth-api-in-brave/522553/2).

### Linux
On Linux you might need to turn on the experimental platforms feature flag in your browser:

- Chrome: `chrome://flags/#enable-experimental-web-platform-features`

- Edge: `edge://flags/#enable-experimental-web-platform-features`

- Opera: `opera://flags/#enable-experimental-web-platform-features`

### iOS
Not Supported by the Web version

## Supported Trainers

### FTMS, FE-C over BLE, or WahooCPS

Works with all trainers that implement the bluetooth Fitness Machine Service (FTMS) or the Tacx FE-C over BLE solution.

The following table is copied from [DC Rainmaker Trainer Guide](https://www.dcrainmaker.com/2020/11/smart-cycle-trainer-recommendations-guide-winter.html/#technical-considerations) and shows current protocol support across the industry.

```
- Elite:    ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Gravat:   ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers
- JetBlack: ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Kinetic:  ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Minoura:  ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Saris:    ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- STAC:     ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Tacx:     ANT+ FE-C on all ‘Smart’ branded trainers (except Satori). FTMS on all non-NEO models. FEC over BLE on NEO.
- Wahoo:    ANT+ FE-C on all smart trainers. FTMS on all 2020 smart trainer.
- 4iiii:    ANT+ FE-C and Bluetooth FTMS on Fliiiight (--Ed)
- Schwinn:  Bluetooth FTMS on the IC8 / 800IC (--Ed)
```

### ANT+

Support for ANT+ is experimental at the moment. It is being rewritten right now and the code is moved to [WebANT](https://github.com/dvmarinoff/WebANT), which has a separate demo. When it becomes stable enough will be merged here. It currently has support for Ubuntu(Linux), and partially for MacOS, and Android. Windows 10 may be possible in the future.


The current development setup is using Suunto movestick mini, Garmin Fenix 5 watch broadcasting heart rate,
Tacx Heart Rate monitor, Tacx Flux S trainer, and X240 laptop with Ubuntu 20.04.2 LTS, M1 Mac, and Samsung S9 Android phone.

## Manual
- [How to create a Profile and Connect Intervals.icu](https://forum.intervals.icu/t/auuki-com-intervals-icu-integration/87105)
- [How-To: Using the connection settings](https://github.com/dvmarinoff/Auuki/discussions/91)
- [How-To: Using Auuki and another app concurrently](https://github.com/dvmarinoff/Auuki/discussions/101)

## Backers
<div>
    <a href="https://github.com/KlausMu" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/14290221?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/TClin76" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/96434118?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/fvolcic" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/59806465?s=64&v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/napfbike" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/192727271?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/sharalds" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/25537910?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/BenSimpsonAnalytics" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/81325092?v=4" width="48" height="48" />
    </a>
</div>
