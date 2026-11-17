//
// Which ERGatory this build is (rider, Nov 17, 2026: "make a public version
// of the app my dad/others can use. My version stays cf access with all my
// flags turned on").
//
//   home    auuki.d3-mi.com, behind Cloudflare Access: everything, including
//           the trainer room from Home Assistant (room.js, /api/room) and the
//           debug traces (trace.js, /api/trace).
//   public  ergatory.d3-mi.com, open to anyone. The household's extras
//           (the room, the traces, hosting group rides) switch on there only
//           for a browser signed in to the household (household.js); for
//           everyone else it never makes those calls or shows their settings.
//
// Set in the built page: <meta name="ergatory-flavor" content="home">, which
// `npm run release:public` rewrites to "public" in dist-public/index.html
// (scripts/flavor.mjs). The source is the same for both; only that line of
// the build differs. Anything else, or no page, is the household build.
//

export function readFlavor(doc = (typeof document !== 'undefined' ? document : null)) {
    try {
        return doc?.querySelector('meta[name="ergatory-flavor"]')?.content === 'public' ? 'public' : 'home';
    } catch(e) {
        return 'home';
    }
}

export const FLAVOR = readFlavor();

// room and traces: the household's, on either site (household.js decides on
// the public one; these are what the build itself allows)
export const flags = Object.freeze({
    room:   true,
    traces: true,
    // Strava only on the public ERGatory (rider, Nov 17, 2026: "we'll
    // standardize on ergatory for anything strava"): its Strava app's callback
    // domain is ergatory.d3-mi.com, and the household's own rides reach
    // Strava through bikes.
    strava: FLAVOR === 'public',
});

export const PUBLIC_URL = 'https://ergatory.d3-mi.com';

export const APP_NAME = 'ERGatory';
