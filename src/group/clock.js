//
// Server time, for group rides: every rider's interval changes are worked
// out from this clock, so they have to agree on it.
//
// NTP-style over the ride's WebSocket: send our time, the server answers
// with its own, and the round trip tells how far the two are apart. The
// answer with the shortest round trip is the most trustworthy, so the
// offset is the one from the fastest of the last few pings. Local time is
// performance.now() (it never jumps when the OS sets the wall clock).
// doc/group-ride.md § The shared clock.
//

const KEEP = 8;

function localNow() {
    return performance.timeOrigin + performance.now();
}

export function Clock(args = {}) {
    const local = args.local ?? localNow;
    let offset = args.offset ?? null;   // server − local, ms
    let rtt = null;
    let samples = [];

    // the server's answer to a ping sent at t0 (local ms)
    function onPong({t0, server}, t1 = local()) {
        if(!Number.isFinite(t0) || !Number.isFinite(server)) return;
        const r = t1 - t0;
        if(r < 0 || r > 10000) return;
        samples.push({rtt: r, offset: server + r / 2 - t1});
        if(samples.length > KEEP) samples.shift();
        const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        offset = best.offset;
        rtt = best.rtt;
    }

    return Object.freeze({
        onPong,
        ping: () => ({type: 'ping', t0: local()}),
        now: () => local() + (offset ?? 0),
        local,
        synced: () => offset !== null,
        offset: () => offset,
        rtt: () => rtt,
        // a new connection may take a different route: start the estimate
        // again, but keep the last offset until a new one is measured
        reset: () => { samples = []; },
    });
}
