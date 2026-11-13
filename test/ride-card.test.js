/**
 * @jest-environment jsdom
 */

import { fit } from '../src/fit/fit.js';
import { cleanTitle, cardModel, cardSvg, chartFromFit, fileName, extras } from '../src/ride-card.js';

// 10 min at 150, then 3 x (4 min at 260, 2 min at 150), 5 min at 120; FTP 250
function ride() {
    const plan = [[600, 150]];
    for(let i = 0; i < 3; i++) plan.push([240, 260], [120, 150]);
    plan.push([300, 120]);
    const chart = {v: 1, ftp: 250, t: [], w: [], hr: [], target: []};
    let t = 0;
    for(const [dur, target] of plan) {
        for(let i = 0; i < dur; i++) {
            t++;
            chart.t.push(t); chart.target.push(target);
            chart.w.push(target + (t % 2 ? 4 : -4));
            chart.hr.push(target > 200 ? 160 : 130);
        }
    }
    return chart;
}

describe('ride card', () => {
    test('the title loses its emoji and its tail', () => {
        expect(cleanTitle('📊 Capped sub-threshold — 5x8min ≤ 3.0 mmol')).toBe('Capped sub-threshold');
        expect(cleanTitle('📊 🔒 QUALITY — Threshold 3x14 @ 97% (repeat the dose) + 🎧 TEST 2')).toBe('Threshold 3x14 @ 97%');
        expect(cleanTitle('')).toBe('');
    });

    test('blocks are the targets; the reps are the hard ones, labelled', () => {
        const m = cardModel(ride(), {name: '📊 Over-unders — 3x4'});
        expect(m.title).toBe('Over-unders');
        expect(m.end).toBe(600 + 3 * 360 + 300);
        expect(m.blocks.length).toBe(8);
        expect(m.labels.map((r) => [r.n, r.w, r.hr, r.target])).toEqual([[1, 260, 160, 260], [2, 260, 160, 260], [3, 260, 160, 260]]);
        expect(m.labels[0].s0).toBe(600);
        expect(m.labels[0].s1).toBe(840);
        const stat = Object.fromEntries(m.stats.map(([v, k]) => [k, v]));
        expect(stat.time).toBe('0:33');
        expect(stat.IF).toMatch(/^0\.\d\d$/);
        expect(Number(stat.TSS)).toBeGreaterThan(20);
    });

    test('a target nudged mid-rep is still one rep', () => {
        const c = ride();
        for(let i = 700; i < 840; i++) c.target[i] = 265;
        const m = cardModel(c);
        expect(m.labels.length).toBe(3);
        expect(m.labels[0].s1 - m.labels[0].s0).toBe(240);
    });

    test('no FTP: no reps, still a picture', () => {
        const c = ride();
        c.ftp = 0;
        const m = cardModel(c);
        expect(m.labels).toEqual([]);
        expect(cardSvg(m)).toMatch(/^<svg[\s\S]*<\/svg>$/);
    });

    test('the svg is well-formed XML, and carries no title', () => {
        const svg = cardSvg(cardModel(ride(), {name: 'Tom & Jerry <3'}));
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(doc.getElementsByTagName('parsererror').length).toBe(0);
        expect(svg).not.toContain('Tom');
        expect(svg).not.toContain('Auuki');
        expect(svg).toContain('rep 2 · 160 bpm');
        expect(svg).toContain('>plan<');
        expect(svg).not.toContain('target set');
    });

    test('the blocks are the plan; a target set off it is a dashed line', () => {
        const c = ride();
        c.plan = c.target.slice();
        // Workout % at 95 through the second rep (s 960 to 1200), and a 5 s nudge that is ignored
        for(let i = 960; i < 1200; i++) c.target[i] = Math.round(c.target[i] * 0.95);
        for(let i = 1400; i < 1405; i++) c.target[i] = c.target[i] + 20;
        const m = cardModel(c);
        expect(m.blocks.map((b) => b.lo)).toEqual([150, 260, 150, 260, 150, 260, 150, 120]);
        expect(m.labels.length).toBe(3);
        expect(m.set).toEqual([{s0: 960, s1: 1200, w: 247}]);
        const svg = cardSvg(m);
        expect(svg).toContain('stroke-dasharray="8 6"');
        expect(svg).toContain('target set');
    });

    test('no plan kept: the blocks are the targets set', () => {
        const c = ride();
        c.plan = c.target.map(() => 0);
        expect(cardModel(c).blocks.length).toBe(8);
        expect(cardModel(c).set).toEqual([]);
    });

    test('an older ride comes back from its FIT, targets from the loaded workout by lap', () => {
        const start = Date.UTC(2026, 10, 13, 16, 0, 0);
        const records = [], laps = [];
        const durs = [60, 30];
        let t = 0;
        durs.forEach((d) => {
            const s = start + t * 1000;
            for(let i = 0; i < d; i++) { records.push({timestamp: start + t * 1000, power: 200 + (t % 3), heart_rate: 140, cadence: 90, speed: 0, distance: 0}); t++; }
            laps.push({start_time: s, timestamp: start + (t - 1) * 1000});
        });
        const view = fit.localActivity.encode({records, laps, events: [], ftp: 250});
        const workout = {meta: {name: '📊 Test — thing'}, intervals: [
            {duration: 60, steps: [{duration: 60, power: 0.8}]},
            {duration: 20, steps: [{duration: 20, power: 1.1}]},
        ]};
        const chart = chartFromFit(new DataView(view.buffer), {name: 'Test', workout, toAbsolute: (v, ftp) => Math.round(v * ftp)});
        expect(chart.ftp).toBe(250);
        expect(chart.t.length).toBe(90);
        expect(chart.w[0]).toBe(200);
        expect(chart.hr[5]).toBe(140);
        expect(chart.target.slice(0, 60).every((x) => x === 200)).toBe(true);
        // the second lap ran 10 s past its 20 s interval: its last step holds
        expect(chart.target.slice(60).every((x) => x === 275)).toBe(true);

        const other = chartFromFit(new DataView(view.buffer), {name: 'Something else', workout, toAbsolute: (v, ftp) => Math.round(v * ftp)});
        expect(other.target.every((x) => x === 0)).toBe(true);
    });

    test('file name is the ride date', () => {
        expect(fileName(new Date(2026, 10, 13, 12).getTime())).toBe('ride-2026-11-13.png');
    });

    test('the extras are lines on the chart, only what the ride carries', () => {
        const c = ride();
        expect(extras(c)).toEqual({temp: [], co2: [], cad: [], fan: []});
        let svg = cardSvg(cardModel(c));
        expect(svg).not.toContain('room °F');

        c.cad = c.w.map((w, i) => (i >= 1200 && i < 1260 ? 0 : 90));     // a minute stopped
        c.room = [
            {t: 0, temp: 62.4, hum: 50, co2: 660, front: 0, rear: 0},
            {t: 600, temp: 63.0, hum: 51, co2: 820, front: 1, rear: 0},
            {t: 1200, temp: 64.0, hum: 53, co2: 1180, front: 1, rear: 0},
            {t: 1800, temp: 65.1, hum: 55, co2: 1120, front: 0, rear: 0},
        ];
        const e = extras(c);
        expect(e.temp).toEqual([[0, 62.4], [600, 63.0], [1200, 64.0], [1800, 65.1]]);
        expect(e.co2.map((p) => p[1])).toEqual([660, 820, 1180, 1120]);
        expect(e.fan).toEqual([{s0: 600, s1: 1800}]);
        expect(e.cad.length).toBe(Math.ceil(c.t.length / 60));
        expect(e.cad.filter((p) => p[1] === null).length).toBe(1);   // the stop breaks the line

        svg = cardSvg(cardModel(c));
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(doc.getElementsByTagName('parsererror').length).toBe(0);
        for(const s of ['room °F', 'CO₂', 'cadence', 'fan on', '65.1°F', '1,120 ppm', '90 rpm']) expect(svg).toContain(s);
        expect(svg).toContain('stroke="#4dd0e1"');
    });
});
