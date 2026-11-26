import { posterSvg, headlineOf, mergeRamps } from '../src/poster.js';

// Nov 26, 2026: the ride image as a poster
const ftp = 282;
const block = (s0, dur, pct) => ({s0, s1: s0 + dur, lo: Math.round(ftp * pct), hi: Math.round(ftp * pct)});
function ride(blocks, labels = []) {
    const end = Math.max(...blocks.map((b) => b.s1));
    const pts = [];
    for(let t = 5; t <= end; t += 5) {
        const b = blocks.find((q) => t > q.s0 && t <= q.s1);
        pts.push([t, b ? b.lo : 120, b ? 100 + b.lo / 5 : 110]);
    }
    return {title: 'Test', ftp, end, step: 5, pts, blocks, labels,
        stats: [['1:00', 'time'], ['216 W', 'NP'], ['0.77', 'IF'], ['70', 'TSS'], ['900', 'kJ'], ['131', 'avg bpm']]};
}

describe('the headline: the main set', () => {
    test('5 × 8 min, and a lone 3-min opener before it is not a sixth rep', () => {
        const opener = block(600, 180, 0.85);
        const reps = [0, 1, 2, 3, 4].map((i) => block(1200 + i * 660, 480, 0.88));
        const labels = [opener, ...reps].map((b) => ({s0: b.s0, s1: b.s1, target: b.lo}));
        expect(headlineOf(ride([opener, ...reps], labels))).toMatchObject({main: '5×8', unit: 'MIN'});
    });
    test('30/15s the card model does not label: counted from the blocks, the openers left out', () => {
        const openers = [block(300, 30, 1.0), block(360, 30, 1.0)];
        const reps = Array.from({length: 13}, (_, i) => block(900 + i * 45, 30, 1.25));
        const h = headlineOf(ride([...openers, ...reps]));
        expect(h).toMatchObject({main: '13×30', unit: 'SEC'});
    });
    test('laps pressed by hand round to the minute', () => {
        const reps = [478, 492, 485].map((d, i) => ({s0: 600 + i * 700, s1: 600 + i * 700 + d, target: 260}));
        expect(headlineOf({ftp, end: 3600, blocks: [], labels: reps})).toMatchObject({main: '3×8', unit: 'MIN'});
    });
    test("Oct 8, 2026: three '14-minute' laps of 12:44, 12:46 and 12:35 are one set of three", () => {
        const reps = [764, 766, 755].map((d, i) => ({s0: 3000 + i * 1200, s1: 3000 + i * 1200 + d, target: 286}));
        expect(headlineOf({ftp: 295, end: 9000, blocks: [], labels: reps})).toMatchObject({main: '3×13', unit: 'MIN'});
    });
    test('one long effort is its length; no main set is the ride', () => {
        expect(headlineOf({ftp, end: 2400, blocks: [], labels: [{s0: 600, s1: 1800, target: 280}]})).toMatchObject({main: '20', unit: 'MIN'});
        expect(headlineOf(ride([block(0, 3600, 0.68)]))).toMatchObject({main: '60', unit: 'MIN'});
        expect(headlineOf({ftp: 0, end: 2700, blocks: [], labels: []})).toMatchObject({main: '45', unit: 'MIN'});
    });
});

describe('a ramp is one sloped block', () => {
    test('a 10 s stair merges; a real step up does not', () => {
        const stair = Array.from({length: 30}, (_, i) => ({s0: i * 10, s1: i * 10 + 10, lo: 155 + i * 2, hi: 155 + i * 2}));
        const out = mergeRamps([...stair, {s0: 300, s1: 780, lo: 248, hi: 248}], ftp);
        expect(out).toEqual([{s0: 0, s1: 300, lo: 155, hi: 213}, {s0: 300, s1: 780, lo: 248, hi: 248}]);
    });
});

describe('the poster', () => {
    const reps = [0, 1, 2, 3, 4].map((i) => block(1200 + i * 660, 480, 0.88));
    const m = ride([block(0, 1200, 0.6), ...reps], reps.map((b) => ({s0: b.s0, s1: b.s1, target: b.lo})));
    const svg = posterSvg(m);
    test('3:2, its fonts inside, the name as a label, and infERGno.com', () => {
        expect(svg).toMatch(/^<svg[^>]*width="1500" height="1000"/);
        expect(svg).toContain("@font-face{font-family:'InfergnoDisplay'");
        expect(svg).toContain('>TEST<');
        expect(svg).toMatch(/inf<tspan[^>]*>E<\/tspan><tspan[^>]*>R<\/tspan><tspan[^>]*>G<\/tspan>no<tspan[^>]*>\.com/);
    });
    test('no date, no FTP figure, no headline: the FTP line says only FTP', () => {
        expect(svg).not.toMatch(/of FTP|Nov \d|5×8/);
        expect(svg).toContain('>FTP<');
        expect(svg).not.toContain(`>${ftp}<`);
    });
    test("the four numbers Strava's header does not show: NP, the main set, average HR, TSS", () => {
        for(const k of ['NP', 'MAIN SET', 'AVG HR', 'TSS']) expect(svg).toContain(`>${k}<`);
        expect(svg).toContain('>248 W<');                    // the reps' own watts
        expect(svg).not.toMatch(/>TIME<|>AVG POWER</);
    });
    test('heart rate is one red line with a heart, and power has its W; only the reps are coloured', () => {
        expect(svg.match(/stroke="#ec1f45"/g)).toHaveLength(1);
        expect(svg).toContain('fill="#ec1f45"/>');
        expect(svg).toMatch(/>W<\/text>/);
        expect(svg.match(/fill="#ffa877"/g)).toHaveLength(5);
    });
    test('no main set: kJ, and the work is coloured; no heart rate: the time', () => {
        const z2 = ride([block(0, 600, 0.55), block(600, 3000, 0.7), block(3600, 300, 0.5)]);
        z2.pts = z2.pts.map(([t, w]) => [t, w, 0]);
        z2.stats = z2.stats.map(([v, k]) => [k === 'avg bpm' ? '—' : v, k]);   // as cardModel says it
        const s2 = posterSvg(z2, {fonts: ''});
        expect(s2).toContain('>KJ<');
        expect(s2).toContain('>TIME<');
        expect(s2).not.toContain('stroke="#ec1f45"');
        expect(s2.match(/fill="#ffa877"/g)).toHaveLength(1);
    });
    test('escapes the name, and a long one is cut', () => {
        const t = ride([block(0, 600, 0.6)]);
        t.title = 'Tom & Jerry <3';
        expect(posterSvg(t, {fonts: ''})).toContain('TOM &amp; JERRY &lt;3');
        t.title = 'x'.repeat(80);
        expect(posterSvg(t, {fonts: ''})).toContain(`${'X'.repeat(43)}…`);
    });
});
