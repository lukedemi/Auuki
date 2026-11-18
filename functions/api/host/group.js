//
// POST /api/host/group — create a group ride (doc/group-ride.md). The host
// is the household (a request Cloudflare Access signed, as on
// auuki.d3-mi.com) or, since Nov 18, 2026, anyone signed in with Strava
// (rider: "I want to allow anyone who has signed in with Strava to create a
// group ride"): their Strava token, checked the way /api/rider checks it.
// The Worker (reached only through this service binding) takes the host's
// name from the header set here.
//
// Each new ride pushes to the rider's phone through Home Assistant's
// notify.pushover_debug (rider: "push notification to push over anytime
// somebody creates a group ride"), and is logged.
//
import { whoIs } from '../rider.js';
import { record } from '../log.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});

// the host: the household's Access login, or a Strava rider
export async function hostOf(request, env, deps = {}) {
    const email = request.headers.get('cf-access-authenticated-user-email');
    if(request.headers.get('cf-access-jwt-assertion') && email) return {id: email, name: email.split('@')[0], via: 'household'};
    if(!env.DB) return null;
    const a = await whoIs(request, env, deps).catch(() => null);
    return a ? {id: `strava:${a.id}`, name: a.name || `Strava rider ${a.id}`, via: 'strava'} : null;
}

// the push: one line for the phone, the guest link to tap
export async function notify(env, {title, host, startAt, minutes, link, site}, fetcher = (...a) => fetch(...a)) {
    if(!env.HA_URL || !env.HA_TOKEN) return false;
    const when = new Date(startAt).toLocaleString('en-US', {timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
    const r = await fetcher(`${env.HA_URL.replace(/\/$/, '')}/api/services/notify/pushover_debug`, {
        method: 'POST',
        headers: {authorization: `Bearer ${env.HA_TOKEN}`, 'content-type': 'application/json'},
        body: JSON.stringify({
            title: `infERGno group ride: ${title}`,
            message: `${host} is hosting ${title} on ${site}, ${when}, ${minutes} min.`,
            data: {priority: 0, url: link, url_title: 'Open the ride'},
        }),
    }).catch(() => null);
    return !!r?.ok;
}

export async function onRequestPost(context) {
    const {request, env} = context;
    if(!env.GROUP_API) return json({error: 'group rides are not set up here'}, 501);
    const host = await hostOf(request, env);
    if(!host) return json({error: 'Sign in with Strava to host a group ride', signIn: 'strava'}, 401);

    const body = await request.text();
    const headers = new Headers({'content-type': 'application/json'});
    headers.set('Cf-Access-Authenticated-User-Email', host.via === 'household' ? host.id : `${host.name} <${host.id}>`);
    const res = await env.GROUP_API.fetch(new Request(request.url, {method: 'POST', headers, body}));
    const out = await res.json().catch(() => ({}));
    if(!res.ok) return json(out, res.status);

    const origin = new URL(request.url).origin;
    // on the public site the guests ride here too; the household copy keeps
    // the Worker's guest site (its own address is behind Access)
    if(!/\.d3-mi\.com$/.test(new URL(request.url).hostname)) out.guestOrigin = origin;
    const sent = (() => { try { return JSON.parse(body); } catch(e) { return {}; } })();
    const title = out.title ?? sent.title ?? sent.workout?.meta?.name ?? 'Group ride';
    // the guests' link, as the app writes it (src/group/group.js rideLink)
    const link = `${out.guestOrigin || origin}/?g=${out.id}#k=${out.joinKey}`;
    const work = Promise.all([
        notify(env, {title, host: host.name, startAt: out.startAt, minutes: Math.round((out.durationS || 0) / 60), link, site: new URL(origin).host}),
        record(env, request, {kind: 'group:create', who: host.name, visitor: request.headers.get('x-infergno-visitor'),
            data: {ride: out.id, title, startAt: out.startAt, minutes: Math.round((out.durationS || 0) / 60), workout: sent.workout?.meta?.name, via: host.via, host: host.id}}),
    ]);
    if(context.waitUntil) context.waitUntil(work); else await work;
    return json(out);
}
