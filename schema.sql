-- D1 `auuki`: debug traces sent by the app (src/trace.js), written by
-- functions/api/trace.js. Read them with scripts/traces.mjs.
CREATE TABLE IF NOT EXISTS sessions (
    session  TEXT PRIMARY KEY,   -- one page load
    started  INTEGER,            -- ms
    last     INTEGER,            -- ms, newest row
    who      TEXT,               -- the Access user
    ua       TEXT,
    version  TEXT,               -- the deployed commit
    rows     INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS traces (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    session  TEXT NOT NULL,
    ts       INTEGER NOT NULL,   -- ms, the browser's clock
    kind     TEXT NOT NULL,      -- state, log, warn, error, event, mark
    data     TEXT                -- JSON
);
CREATE INDEX IF NOT EXISTS traces_session_ts ON traces(session, ts);
CREATE INDEX IF NOT EXISTS traces_ts ON traces(ts);

-- Group rides (doc/group-ride.md), written by workers/group. The live state
-- is in the ride's Durable Object; this is the record.
CREATE TABLE IF NOT EXISTS group_rides (
    id          TEXT PRIMARY KEY,     -- short, URL-safe
    title       TEXT,
    workout     TEXT NOT NULL,        -- the workout JSON, frozen at create time
    start_at    INTEGER NOT NULL,     -- ms
    duration_s  INTEGER NOT NULL,
    host        TEXT,                 -- the Access user who created it
    join_hash   TEXT NOT NULL,        -- sha-256 of the join key
    host_hash   TEXT NOT NULL,        -- sha-256 of the host key
    created     INTEGER,
    closed      INTEGER,
    meeting_id  TEXT                  -- the RealtimeKit meeting, made on first use
);
CREATE INDEX IF NOT EXISTS group_rides_start ON group_rides(start_at);
CREATE TABLE IF NOT EXISTS group_riders (
    ride_id     TEXT NOT NULL,
    rider_id    TEXT NOT NULL,
    name        TEXT,
    joined      INTEGER,
    left        INTEGER,
    media_token TEXT,                 -- their RealtimeKit token, reused on rejoin
    avg_w INTEGER, np_w INTEGER, avg_hr INTEGER, kj INTEGER,   -- the workout portion
    PRIMARY KEY (ride_id, rider_id)
);

-- infERGno riders (rider, Nov 18, 2026: "keep a database of every person who
-- logs in with strava all their settings"), written by functions/api/rider.js.
-- One row per Strava athlete who connected on infergno.com: their
-- settings as the app keeps them in the browser, so a new browser picks them
-- up on connecting. Deleted on Disconnect. Their Strava tokens are never here.
CREATE TABLE IF NOT EXISTS riders (
    athlete_id  INTEGER PRIMARY KEY,  -- Strava's
    name        TEXT,                 -- as Strava has it
    settings    TEXT NOT NULL,        -- JSON: localStorage key -> string
    created_at  INTEGER NOT NULL,     -- ms
    updated_at  INTEGER NOT NULL,     -- ms, the last save of settings
    seen_at     INTEGER NOT NULL      -- ms, the last time the app asked
);
-- who a Strava access token belongs to, so each request does not ask Strava
-- (tokens live 6 h; a row lives 1 h). Only the token's SHA-256 is kept.
CREATE TABLE IF NOT EXISTS rider_tokens (
    token_hash  TEXT PRIMARY KEY,
    athlete_id  INTEGER NOT NULL,
    name        TEXT,
    expires_at  INTEGER NOT NULL      -- ms
);
