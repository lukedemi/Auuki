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
// Set at build time: ERGATORY_FLAVOR=public (npm run release:public).
//

export const FLAVOR = process.env.ERGATORY_FLAVOR === 'public' ? 'public' : 'home';

export const flags = Object.freeze({
    room:   FLAVOR === 'home',
    traces: FLAVOR === 'home',
});

export const APP_NAME = 'ERGatory';
