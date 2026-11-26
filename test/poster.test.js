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
    const svg = posterSvg(ride([block(0, 1200, 0.6), ...reps], reps.map((b) => ({s0: b.s0, s1: b.s1, target: b.lo}))), {date: Date.UTC(2026, 10, 13, 15)});
    test("carries its fonts, the headline, the reps' target, the four numbers and infERGno.com", () => {
        expect(svg).toMatch(/^<svg[^>]*width="1200" height="1500"/);
        expect(svg).toContain("@font-face{font-family:'InfergnoDisplay'");
        expect(svg).toContain('>5×8<');
        expect(svg).toContain('at 248 W · 88% of FTP');
        for(const k of ['TIME', 'NP', 'TSS', 'AVG BPM']) expect(svg).toContain(`>${k}<`);
        expect(svg).toContain('Nov 13, 2026');
        expect(svg).toMatch(/inf<tspan[^>]*>E<\/tspan><tspan[^>]*>R<\/tspan><tspan[^>]*>G<\/tspan>no<tspan[^>]*>\.com/);
        expect(svg).not.toContain('legend');
    });
    test('heart rate is one red line with a heart, and power has its W', () => {
        expect(svg.match(/stroke="#ec1f45"/g)).toHaveLength(1);
        expect(svg).toContain('fill="#ec1f45"/>');           // the heart
        expect(svg).toMatch(/>W<\/text>/);
    });
    test('escapes the title, and draws a ride with no heart rate and no plan', () => {
        const m = ride([block(0, 600, 0.6)]);
        m.title = 'Tom & Jerry <3';
        m.pts = m.pts.map(([t, w]) => [t, w, 0]);
        m.blocks = [];
        const s = posterSvg(m, {fonts: ''});
        expect(s).toContain('TOM &amp; JERRY &lt;3');
        expect(s).not.toContain('stroke="#ec1f45"');
        expect(s).toContain('>10<');                          // ten minutes
    });
});
