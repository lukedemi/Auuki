//
// infergno.com is the app's address since Nov 18, 2026 (rider: "bought
// infergno.com"). Before it the public app was ERGatory at ergatory.d3-mi.com
// (Nov 17) and pERGatory at pergatory.d3-mi.com (Nov 18). Both old addresses,
// and www.infergno.com, now send their pages to the same path on infergno.com;
// everything else is still served there, above all /transfer.html (and the
// scripts it loads), which infERGno opens in a frame to bring each browser's
// settings, rides and Strava connection over (src/transfer.js). The API stays
// put too, for a tab left open across the move.
//
// Every other address this project or the household's serves passes
// straight through.
//
export const NEW_ORIGIN = 'https://infergno.com';
export const OLD_HOSTS = ['ergatory.d3-mi.com', 'pergatory.d3-mi.com', 'www.infergno.com'];

// a page, as opposed to a script, an image, the API or the transfer page
export function isPage(path) {
    // Pages serves /transfer.html as /transfer (it drops .html with a 308)
    if(path === '/transfer.html' || path === '/transfer' || path.startsWith('/api/') || path.startsWith('/cdn-cgi/')) return false;
    const last = path.split('/').pop();
    return last === '' || last.endsWith('.html') || !last.includes('.');
}

// the old address, named, so infERGno can offer to bring that browser's things over
const MOVED = {'ergatory.d3-mi.com': 'ergatory', 'pergatory.d3-mi.com': 'pergatory'};

export function redirectFor(url) {
    const u = new URL(url);
    if(!OLD_HOSTS.includes(u.hostname) || !isPage(u.pathname)) return null;
    const q = new URLSearchParams(u.search);
    if(MOVED[u.hostname]) q.set('moved', MOVED[u.hostname]);
    const search = q.toString() ? `?${q}` : '';
    return `${NEW_ORIGIN}${u.pathname}${search}${u.hash}`;
}

export async function onRequest({request, next}) {
    const to = redirectFor(request.url);
    return to ? Response.redirect(to, 302) : next();
}
