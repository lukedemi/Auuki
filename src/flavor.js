//
// Which ERGatory this build is (rider, Nov 17, 2026: "make a public version
// of the app my dad/others can use. My version stays cf access with all my
// flags turned on").
//
//   home    auuki.d3-mi.com, behind Cloudflare Access: everything, including
//           the trainer room from Home Assistant (room.js, /api/room) and the
//           debug traces (trace.js, /api/trace).
//   public  ergatory.d3-mi.com, open to anyone: the app without those two.
//           It never makes those calls or shows their settings, and it is
//           deployed with no server functions at all.
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

export const flags = Object.freeze({
    room:   FLAVOR === 'home',
    traces: FLAVOR === 'home',
});

export const APP_NAME = 'ERGatory';
