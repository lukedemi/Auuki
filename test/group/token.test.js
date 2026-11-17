/**
 * @jest-environment node
 */
import { sign, verify, sha256, randomKey, randomId, same } from '../../workers/group/src/token.js';

const SECRET = 'a-test-secret-of-some-length';

describe('tokens', () => {
    test('round trip', async () => {
        const t = await sign({r: 'ride', p: 'r_1', exp: Date.now() + 1000}, SECRET);
        expect(await verify(t, SECRET)).toMatchObject({r: 'ride', p: 'r_1'});
    });
    test('wrong secret, tampering and expiry fail', async () => {
        const t = await sign({r: 'ride', p: 'r_1', exp: Date.now() + 1000}, SECRET);
        expect(await verify(t, 'another-secret-of-length')).toBe(null);
        const [body, sig] = t.split('.');
        const forged = Buffer.from(JSON.stringify({r: 'ride', p: 'r_2', exp: Date.now() + 1000})).toString('base64url');
        expect(await verify(`${forged}.${sig}`, SECRET)).toBe(null);
        expect(await verify(t, SECRET, Date.now() + 2000)).toBe(null);
        expect(await verify('junk', SECRET)).toBe(null);
        expect(await verify(undefined, SECRET)).toBe(null);
    });
    test('a short secret is refused', async () => {
        await expect(sign({exp: 1}, 'short')).rejects.toThrow(/TOKEN_SECRET/);
    });
    test('keys and ids', async () => {
        expect(randomKey()).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(randomId()).toMatch(/^[a-z2-9]{10}$/);
        expect(await sha256('x')).toBe(await sha256('x'));
        expect(same('abc', 'abc')).toBe(true);
        expect(same('abc', 'abd')).toBe(false);
        expect(same('abc', 'ab')).toBe(false);
    });
});
