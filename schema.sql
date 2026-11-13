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
