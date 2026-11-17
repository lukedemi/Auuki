//
// Session tokens and secrets for group rides.
//
// A token is `<payload>.<sig>`: base64url JSON and its HMAC-SHA256 under
// TOKEN_SECRET. Checking one needs no lookup, so a reconnect works however
// the Durable Object or D1 are doing. Join and host keys are random 128-bit
// strings; only their SHA-256 is stored.
//

const enc = new TextEncoder();

export function b64url(bytes) {
    let s = '';
    for(const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function randomKey(bytes = 16) {
    return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// short, unambiguous ids for URLs
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomId(n = 10) {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function sha256(text) {
    const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return b64url(new Uint8Array(d));
}

async function hmacKey(secret) {
    if(!secret || secret.length < 16) throw new Error('TOKEN_SECRET is missing or too short');
    return crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}

export async function sign(payload, secret) {
    const body = b64url(enc.encode(JSON.stringify(payload)));
    const key = await hmacKey(secret);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
    return `${body}.${b64url(sig)}`;
}

// the payload, or null for anything forged, garbled or expired
export async function verify(token, secret, now = Date.now()) {
    if(typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if(!body || !sig) return null;
    try {
        const key = await hmacKey(secret);
        const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(body));
        if(!ok) return null;
        const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
        if(!(payload.exp > now)) return null;
        return payload;
    } catch(_) {
        return null;
    }
}

// equal-time string compare, for keys
export function same(a, b) {
    if(typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let d = 0;
    for(let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}
