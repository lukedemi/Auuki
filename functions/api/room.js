//
// GET /api/room — the trainer room, from Home Assistant (rider, Nov 13, 2026:
// "pull in home assistant data about the co2 in the room, temp in the room,
// fan status").
//
// One call to HA's template API renders every value at once, so the
// browser never holds an HA token and HA needs no CORS: HA_URL and HA_TOKEN
// are secrets on this Pages project. The site is behind Access, so only the
// household reaches it.
//
// Temperature and humidity: the room's own sensor first, the CO2 unit's
// second (homeassistant docs/SENSORS.md, the trust table). A value whose
// sensor has not spoken for 20 minutes is dropped, not shown stale.
//

export const ENTITIES = {
    temp:    ['sensor.trainer_room_temperature', 'sensor.basement_exercise_area_trainer_room_co2_temperature'],
    hum:     ['sensor.trainer_room_humidity', 'sensor.basement_exercise_area_trainer_room_co2_humidity'],
    co2:     ['sensor.basement_exercise_area_trainer_room_co2_carbon_dioxide'],
    front:   ['switch.trainer_front_fan'],
    frontW:  ['sensor.trainer_front_fan_power'],
    rear:    ['switch.trainer_rear_fan'],
    rearW:   ['sensor.trainer_rear_fan_power'],
};
const STALE_S = 20 * 60;

// {"sensor.x": [state, last_reported epoch s], …}
export function template(ids) {
    const parts = ids.map((id) =>
        `"${id}": [{{ states('${id}') | tojson }}, {{ (as_timestamp(states.${id}.last_reported, 0) if states.${id} else 0) | tojson }}]`);
    return `{${parts.join(', ')}}`;
}

export function shape(raw, now = Date.now() / 1000) {
    const val = (key, kind) => {
        for(const id of ENTITIES[key]) {
            const [state, at] = raw[id] ?? [];
            if(state === undefined || state === null || state === 'unknown' || state === 'unavailable') continue;
            if(kind === 'num') {
                const n = Number(state);
                if(!Number.isFinite(n)) continue;
                if(at && now - at > STALE_S) continue;
                return n;
            }
            return state;
        }
        return null;
    };
    // a plug reports its watts on change, so a steady fan's last report can be old: no staleness here
    const fan = (on, w) => {
        const state = val(on, 'str');
        if(state === null) return null;
        if(state !== 'on') return {on: false, w: 0};
        const watts = Number((raw[ENTITIES[w][0]] ?? [])[0]);
        return {on: true, w: Number.isFinite(watts) ? Math.round(watts) : null};
    };
    return {
        temp_f: val('temp', 'num'),
        humidity: val('hum', 'num'),
        co2: val('co2', 'num'),
        fans: {front: fan('front', 'frontW'), rear: fan('rear', 'rearW')},
        at: Math.round(now),
    };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
});

export async function onRequestGet({env}) {
    if(!env.HA_URL || !env.HA_TOKEN) return json({error: 'Home Assistant is not configured'}, 503);
    const ids = Object.values(ENTITIES).flat();
    const body = JSON.stringify({template: template(ids)});
    let last = null;
    // the house's front door (a Tailscale Funnel) drops a connection now and then
    for(let i = 0; i < 3; i++) {
        try {
            const r = await fetch(`${env.HA_URL.replace(/\/$/, '')}/api/template`, {
                method: 'POST',
                headers: {'Authorization': `Bearer ${env.HA_TOKEN}`, 'Content-Type': 'application/json'},
                body,
            });
            if(!r.ok) { last = `Home Assistant answered ${r.status}`; if(r.status < 500) break; continue; }
            return json(shape(JSON.parse(await r.text())));
        } catch(e) {
            last = e.message;
        }
    }
    return json({error: last ?? 'Home Assistant did not answer'}, 502);
}
