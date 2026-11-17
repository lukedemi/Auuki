//
// The group ride's WebSocket, which expects to be dropped.
//
// It reconnects by itself, with backoff and jitter (so ten riders don't all
// retry on the same instant after the server restarts), and it doesn't
// trust the browser to notice a dead connection: nothing from the server for
// staleMs means close and reconnect. The server sends everyone a tick a
// second while anyone is riding, and answers pings, so silence is a fault.
//
// Close codes 4000–4099 are the server saying "don't come back" (the ride
// was closed, you were removed, you joined from another tab).
// doc/group-ride.md § Durability.
//

export const BACKOFF_MS = [500, 1000, 2000, 4000, 10000];

export function backoff(attempt, random = Math.random) {
    const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    return Math.round(base * (1 + (random() - 0.5) * 0.6));
}

export function isTerminal(code) {
    return code >= 4000 && code < 4100;
}

export function Connection(args = {}) {
    const {
        url,                       // () => string, asked again on each attempt
        onMessage = () => {},
        onState = () => {},        // 'connecting' | 'open' | 'reconnecting' | 'ended'
        onOpen = () => {},
        WebSocketImpl = globalThis.WebSocket,
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = (id) => clearTimeout(id),
        now = () => Date.now(),
        random = Math.random,
        staleMs = 4000,
    } = args;

    let ws = null;
    let attempt = 0;
    let lastHeard = 0;
    let retryTimer = null;
    let watchTimer = null;
    let stopped = false;
    let state = 'idle';

    function setState(s, detail) {
        if(state === s) return;
        state = s;
        onState(s, detail);
    }

    function connect() {
        if(stopped) return;
        clearTimer(retryTimer);
        retryTimer = null;
        setState(attempt === 0 ? 'connecting' : 'reconnecting');
        let sock;
        try {
            sock = new WebSocketImpl(url());
        } catch(err) {
            return retry();
        }
        ws = sock;
        lastHeard = now();
        sock.onopen = () => {
            if(sock !== ws) return;
            attempt = 0;
            lastHeard = now();
            setState('open');
            onOpen();
        };
        sock.onmessage = (e) => {
            if(sock !== ws) return;
            lastHeard = now();
            let msg;
            try { msg = JSON.parse(e.data); } catch(_) { return; }
            onMessage(msg);
        };
        sock.onclose = (e) => {
            if(sock !== ws) return;
            ws = null;
            if(isTerminal(e?.code)) {
                stopped = true;
                stopWatch();
                setState('ended', {code: e.code, reason: e.reason});
                return;
            }
            retry();
        };
        sock.onerror = () => {};
        startWatch();
    }

    function retry() {
        if(stopped) return;
        setState('reconnecting');
        const ms = backoff(attempt, random);
        attempt += 1;
        retryTimer = setTimer(connect, ms);
    }

    // the browser can sit on a dead socket for minutes
    function startWatch() {
        if(watchTimer !== null) return;
        const check = () => {
            watchTimer = setTimer(check, 1000);
            if(!ws || now() - lastHeard <= staleMs) return;
            const dead = ws;
            ws = null;
            try { dead.close(); } catch(_) {}
            retry();
        };
        watchTimer = setTimer(check, 1000);
    }
    function stopWatch() {
        if(watchTimer !== null) clearTimer(watchTimer);
        watchTimer = null;
    }

    function send(msg) {
        if(!ws || ws.readyState !== 1) return false;
        try { ws.send(JSON.stringify(msg)); return true; } catch(_) { return false; }
    }

    function close() {
        stopped = true;
        clearTimer(retryTimer);
        stopWatch();
        const sock = ws;
        ws = null;
        try { sock?.close(1000, 'leaving'); } catch(_) {}
        setState('ended', {code: 1000});
    }

    return Object.freeze({
        connect,
        send,
        close,
        state: () => state,
        // for tests and the chaos script: drop the socket as a network would
        drop: () => { const sock = ws; ws = null; try { sock?.close(); } catch(_) {} retry(); },
    });
}
