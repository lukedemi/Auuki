/**
 * @jest-environment jsdom
 */

import { collect, apply, carried } from '../src/transfer.js';
import { onRequestGet as me } from '../functions/api/me.js';

global.Response = global.Response ?? class { constructor(body, init = {}) { this._b = body; this.status = init.status ?? 200; this.ok = this.status < 400; } async json() { return JSON.parse(this._b); } };
const hdrs = (h) => ({get: (k) => h[k.toLowerCase()] ?? null});

describe('the household, on the public site', () => {
    test('/api/me says yes only to a request Access signed', async () => {
        expect((await me({request: {headers: hdrs({})}})).status).toBe(403);
        expect((await me({request: {headers: hdrs({'cf-access-authenticated-user-email': 'x@y'})}})).status).toBe(403);   // forged email, no signature
        const ok = await me({request: {headers: hdrs({'cf-access-authenticated-user-email': 'x@y', 'cf-access-jwt-assertion': 'jwt'})}});
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({household: true, email: 'x@y'});
    });

    test('the app believes /api/me, remembers it, and forgets it on a no', async () => {
        const yes = async () => ({ok: true, headers: {get: () => 'application/json'}, json: async () => ({household: true, email: 'luke@x'})});
        const loginRedirect = async () => ({ok: false, status: 0, type: 'opaqueredirect', headers: {get: () => null}, json: async () => ({})});
        const meta = document.createElement('meta');
        meta.name = 'ergatory-flavor'; meta.content = 'public';
        document.head.appendChild(meta);
        let hh;
        jest.isolateModules(() => { hh = require('../src/household.js'); });
        const {check, isHousehold, householdEmail} = hh;
        expect(isHousehold()).toBe(false);                                   // public, never asked
        await check(yes);
        expect(isHousehold()).toBe(true);
        expect(householdEmail()).toBe('luke@x');
        expect(JSON.parse(localStorage.getItem('ergatory:household')).household).toBe(true);
        expect(document.documentElement.dataset.household).toBe('1');
        await check(loginRedirect);
        expect(isHousehold()).toBe(false);
        expect(localStorage.getItem('ergatory:household')).toBe(null);
        expect(document.documentElement.dataset.household).toBeUndefined();
        await check(async () => { throw new Error('offline'); });           // offline keeps what it knew
        expect(isHousehold()).toBe(false);
        meta.remove();
    });

    test('the household build is always the household, and never asks', async () => {
        let hh;
        jest.isolateModules(() => { hh = require('../src/household.js'); });
        const asked = jest.fn();
        await hh.check(asked);
        expect(asked).not.toHaveBeenCalled();
        expect(hh.isHousehold()).toBe(true);
    });
});

describe('moving from auuki.d3-mi.com', () => {
    const store = (init = {}) => {
        const m = new Map(Object.entries(init));
        return {get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), _m: m};
    };
    const fakeIdb = (init = {}) => {
        const s = {activity: [...(init.activity ?? [])], workouts: [...(init.workouts ?? [])]};
        return {getAll: async (n) => s[n].slice(), put: async (n, v) => { s[n] = s[n].filter((x) => x.id !== v.id).concat([v]); }, _s: s};
    };

    test('every setting goes, except what belongs to the site', () => {
        expect(carried('ftp')).toBe(true);
        expect(carried('intervals-direct')).toBe(true);
        expect(carried('sources')).toBe(true);
        expect(carried('ergatory:strava')).toBe(false);
        expect(carried('ergatory:household')).toBe(false);
        expect(carried('ble:remembered')).toBe(false);
    });

    test('collected there, applied here: settings overwrite, rides and workouts add', async () => {
        const there = store({ftp: '295', 'intervals-direct': '{"key":"k"}', 'ble:remembered': '{}', 'ergatory:strava': 'theirs'});
        const thereIdb = fakeIdb({activity: [{id: 'a1'}, {id: 'a2'}], workouts: [{id: 'w1'}]});
        const data = await collect({storage: there, idb: thereIdb});
        expect(Object.keys(data.settings).sort()).toEqual(['ftp', 'intervals-direct']);

        const here = store({ftp: '250', 'ergatory:strava': 'mine'});
        const hereIdb = fakeIdb({activity: [{id: 'a2', mine: true}]});
        const res = await apply(data, {storage: here, idb: hereIdb});
        expect(res).toEqual({settings: 2, rides: 1, workouts: 1});
        expect(here.getItem('ftp')).toBe('295');
        expect(here.getItem('ergatory:strava')).toBe('mine');
        expect(hereIdb._s.activity.find((r) => r.id === 'a2').mine).toBe(true);    // what this site had stays
        expect(hereIdb._s.activity.map((r) => r.id).sort()).toEqual(['a1', 'a2']);
    });
});
