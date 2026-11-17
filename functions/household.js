//
// /household — Settings > Household sign-in goes here. Cloudflare Access
// keeps the path for the household group, so arriving here means the
// sign-in happened (and its cookie now covers this site's other household
// paths); send them back to the app, which then asks /api/me.
//
export function onRequestGet({request}) {
    const url = new URL(request.url);
    return Response.redirect(`${url.origin}/?household=1`, 302);
}
