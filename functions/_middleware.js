//
// ergatory.d3-mi.com was pERGatory's address until Nov 18, 2026 (rider:
// "move the domain over and add the redirect"). Its pages now send the
// browser to the same path on pergatory.d3-mi.com; everything else is still
// served there, above all /transfer.html (and the scripts it loads), which
// pergatory opens in a frame to bring each browser's settings, rides and
// Strava connection over (src/transfer.js). The API stays put too, for a tab
// left open across the move.
//
// Every other address this project or the household's serves passes
// straight through.
//
export const NEW_ORIGIN = 'https://pergatory.d3-mi.com';
export const OLD_HOSTS = ['ergatory.d3-mi.com'];

// a page, as opposed to a script, an image, the API or the transfer page
export function isPage(path) {
    if(path === '/transfer.html' || path.startsWith('/api/') || path.startsWith('/cdn-cgi/')) return false;
    const last = path.split('/').pop();
    return last === '' || last.endsWith('.html') || !last.includes('.');
}

export function redirectFor(url) {
    const u = new URL(url);
    if(!OLD_HOSTS.includes(u.hostname) || !isPage(u.pathname)) return null;
    return `${NEW_ORIGIN}${u.pathname}${u.search}${u.hash}`;
}

export async function onRequest({request, next}) {
    const to = redirectFor(request.url);
    return to ? Response.redirect(to, 302) : next();
}
