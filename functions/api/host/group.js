//
// POST /api/host/group — create a group ride. Kept off /api/group/* so it
// stays behind Cloudflare Access when the guest paths are opened up; the
// Worker checks the Access header too. doc/group-ride.md.
//
export async function onRequestPost({request, env}) {
    // the public site serves this file too; only a request Access signed may host
    if(!request.headers.get('cf-access-jwt-assertion')) return Response.json({error: 'household only'}, {status: 403});
    if(!env.GROUP_API) return Response.json({error: 'group rides are not set up here'}, {status: 501});
    return env.GROUP_API.fetch(request);
}
