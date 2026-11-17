//
// /api/group/* — handed whole to the auuki-group Worker (workers/group),
// WebSocket upgrades included. doc/group-ride.md.
//
export async function onRequest({request, env}) {
    if(!env.GROUP_API) return Response.json({error: 'group rides are not set up here'}, {status: 501});
    return env.GROUP_API.fetch(request);
}
