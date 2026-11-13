/**
 * @jest-environment jsdom
 */

globalThis.__AUUKI_NO_TRACE__ = true;

import { clean, onRequestPost } from '../functions/api/trace.js';
import { Trace } from '../src/trace.js';
import { xf } from '../src/functions.js';

describe('the trace sink', () => {
    test('clean keeps known kinds, bounds the batch and the row size', () => {
        const c = clean({session: 'abc12345-x', meta: {ua: 'UA', version: 'v1', started: 5},
            rows: [{ts: 10, kind: 'state', data: {w: 200}}, {ts: 11, kind: 'nope', data: 'x'.repeat(9000)}]});
        expect(c.session).toBe('abc12345-x');
        expect(c.rows[0]).toEqual({ts: 10, kind: 'state', data: '{"w":200}'});
        expect(c.rows[1].kind).toBe('event');
        expect(JSON.parse(c.rows[1].data).truncated.length).toBe(8000);
        expect(clean({session: 'bad id!', rows: []}).error).toBe('bad session');
    });

    test('a post writes the session and every row in one batch, naming the Access user', async () => {
        const stmts = [];
        const DB = {
            prepare: (sql) => ({ bind: (...a) => ({sql, a}) }),
            batch: async (s) => { stmts.push(...s); return []; },
        };
        const request = {
            headers: new Map([['cf-access-authenticated-user-email', 'rider@example.com']]),
            json: async () => ({session: 'sess-0001', meta: {started: 1}, rows: [{ts: 2, kind: 'mark', data: {text: 'here'}}]}),
        };
        global.Response = global.Response ?? class { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; } };
        const r = await onRequestPost({request, env: {DB}});
        expect(r.status).toBe(200);
        expect(stmts[0].sql).toMatch(/INSERT INTO sessions/);
        expect(stmts[0].a[3]).toBe('rider@example.com');
        expect(stmts.filter((s) => /INSERT INTO traces/.test(s.sql)).length).toBe(1);
    });
});

describe('the trace client', () => {
    test('records app events and a mark; payload carries the session', () => {
        const t = Trace({session: 'test-session-1'});
        // subscribe without wrapping the console or starting timers
        t.event('hello', {a: 1});
        t.mark('look here');
        const rows = t.buffer();
        // mark() flushes; with no network here the rows are kept for the next try
        expect(rows.map((r) => r.kind)).toEqual(['event', 'mark']);
        const body = JSON.parse(t.payload([{ts: 1, kind: 'mark', data: {text: 'x'}}]));
        expect(body.session).toBe('test-session-1');
    });
});
