//
// Everyone in the group ride, as this rider knows them: who is in (the
// roster), their latest numbers (the server's tick) and their last 10
// minutes (for the sparklines and the group chart). The rider's own entry
// is fed from their own sensors, not the server, so it never lags or goes
// grey. Pure: group.js feeds it, the views read it.
//

export const HISTORY = 600;
export const STALE_S = 5;       // numbers greyed
export const GONE_S = 30;       // "reconnecting"

export function Riders(args = {}) {
    const now = args.now ?? (() => Date.now());
    const map = new Map();
    let me = null;

    function get(id) {
        if(!map.has(id)) map.set(id, {id, name: '', host: false, connected: true, me: id === me, latest: null, at: 0, history: []});
        return map.get(id);
    }

    function push(r, row) {
        const last = r.history[r.history.length - 1];
        if(last && last[0] === row[0]) r.history[r.history.length - 1] = row;
        else r.history.push(row);
        if(r.history.length > HISTORY) r.history.splice(0, r.history.length - HISTORY);
    }

    return {
        setMe(id) { me = id; for(const r of map.values()) r.me = r.id === id; },
        me: () => me,
        get: (id) => map.get(id),
        // joined order, me first
        list() {
            return [...map.values()].sort((a, b) => (b.me - a.me) || ((a.joined ?? 0) - (b.joined ?? 0)));
        },
        setRoster(roster = {}) {
            for(const [id, r] of Object.entries(roster)) {
                Object.assign(get(id), {name: r.name, host: !!r.host, connected: !!r.connected, joined: r.joined});
            }
            for(const id of [...map.keys()]) if(!(id in roster) && id !== me) map.delete(id);
        },
        // the server's tick: {riders: {id: {w, hr, cad, tgt, ftp, st8, age}}, server}
        onTick({riders = {}, server}) {
            const t = Math.round((server ?? now()) / 1000);
            for(const [id, s] of Object.entries(riders)) {
                if(id === me) continue;
                const r = get(id);
                r.latest = s;
                r.at = now() - (s.age ?? 0) * 1000;
                push(r, [t, s.w, s.hr, s.cad, s.tgt]);
            }
        },
        // the welcome's history: {id: [[t, w, hr, cad, tgt]]}
        setHistory(history = {}) {
            for(const [id, rows] of Object.entries(history)) {
                if(id === me || !Array.isArray(rows)) continue;
                const r = get(id);
                if(rows.length > r.history.length) r.history = rows.slice(-HISTORY);
            }
        },
        // my own numbers, every second, from my own sensors
        onMine(sample, tSec) {
            if(!me) return;
            const r = get(me);
            r.latest = sample;
            r.at = now();
            push(r, [tSec, sample.w, sample.hr, sample.cad, sample.tgt]);
        },
        // seconds since we last heard from this rider
        age(r) {
            return r.at ? (now() - r.at) / 1000 : Infinity;
        },
        clear() { map.clear(); me = null; },
    };
}

// a rider's state for the tile
export function status(riders, r) {
    if(!r.connected && !r.me) return 'gone';
    const age = riders.age(r);
    if(age > GONE_S) return 'reconnecting';
    if(age > STALE_S) return 'stale';
    const s = r.latest?.st8;
    return s === 'p' ? 'paused' : s === 'c' ? 'coasting' : 'riding';
}

// % of target, for the group chart and the tiles; null without a target
export function pctOfTarget(w, tgt) {
    return tgt > 0 ? Math.round((w / tgt) * 100) : null;
}

// the workout portion's numbers, for the record: avg, NP (30 s rolling), kJ
export function Summary() {
    let n = 0, sumW = 0, hrN = 0, sumHr = 0, npN = 0, sum4 = 0;
    const roll = [];
    let rollSum = 0;
    return {
        add(w, hr) {
            w = Number.isFinite(w) ? w : 0;
            n += 1; sumW += w;
            if(hr > 0) { hrN += 1; sumHr += hr; }
            roll.push(w); rollSum += w;
            if(roll.length > 30) rollSum -= roll.shift();
            if(roll.length === 30) { npN += 1; sum4 += (rollSum / 30) ** 4; }
        },
        result() {
            return {
                avg_w: n ? Math.round(sumW / n) : null,
                np_w: npN ? Math.round((sum4 / npN) ** 0.25) : null,
                avg_hr: hrN ? Math.round(sumHr / hrN) : null,
                kj: Math.round(sumW / 1000),
                seconds: n,
            };
        },
    };
}
