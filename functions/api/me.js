//
// GET /api/me — is this browser signed in to the household? (household.js)
//
// Cloudflare Access keeps this path for the household group on every site
// that serves it, and names the person in Cf-Access-Authenticated-User-Email.
// Without that header (Access did not run, or did not let them in) the answer
// is no.
//
export function onRequestGet({request}) {
    const email = request.headers.get('cf-access-authenticated-user-email');
    const signed = request.headers.get('cf-access-jwt-assertion');
    const household = !!(email && signed);
    return new Response(JSON.stringify(household ? {household: true, email} : {household: false}), {
        status: household ? 200 : 403,
        headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
    });
}
