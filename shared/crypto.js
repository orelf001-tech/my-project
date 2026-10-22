// End-to-end encryption for client form submissions.
// Pure WebCrypto (browser + Node >= 20), no dependencies.
//
//   seal(recipientPublicRaw, obj)   ECIES: ephemeral ECDH P-256 -> HKDF-SHA256 -> AES-256-GCM
//   open(envelope, privateKey, recipientPublicRaw)
//   wrapPrivateKey / unwrapPrivateKey   PBKDF2-SHA256 passphrase protection of the coach key
//   sealSym / openSym                   AES-256-GCM with a random key carried in the link fragment
//
// Every envelope carries a version and the recipient key id, both bound into the AEAD
// additional data, so a ciphertext cannot be replayed under another key or format.

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export const ALG = 'ECDH-P256+HKDF-SHA256+A256GCM';
export const SYM_ALG = 'A256GCM';
export const PBKDF2_ITERATIONS = 600000;
const HKDF_INFO = 'cashflow/intake/v1';
const PAD_BLOCK = 512;

export function b64uEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad-base64');
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const u8 = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  return u8;
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
};

export function randomBytes(n) { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }
export function randomToken(n = 16) { return b64uEncode(randomBytes(n)); }

export async function sha256Hex(str) {
  const h = new Uint8Array(await subtle.digest('SHA-256', te.encode(str)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function kidOf(publicRaw) {
  const raw = typeof publicRaw === 'string' ? b64uDecode(publicRaw) : publicRaw;
  return b64uEncode(new Uint8Array(await subtle.digest('SHA-256', raw))).slice(0, 16);
}

// Plaintext is JSON padded with spaces to a block multiple, so the ciphertext length
// reveals only a coarse size bucket. JSON.parse ignores the trailing whitespace.
function encodePadded(obj) {
  const bytes = te.encode(JSON.stringify(obj));
  const len = Math.ceil((bytes.length + 1) / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(len).fill(0x20);
  out.set(bytes);
  return out;
}
const decodeJson = bytes => JSON.parse(td.decode(bytes));

/* ---------- coach key pair ---------- */

export async function generateKeyPair() {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  return { publicKey: kp.publicKey, privateKey: kp.privateKey, publicRaw: b64uEncode(raw), kid: await kidOf(raw) };
}

export async function importPublicRaw(publicRaw) {
  const raw = b64uDecode(publicRaw);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('bad-public-key');
  return subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

async function deriveAesKey(privateKey, publicKey, epkRaw, rpkRaw) {
  const shared = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: concat(te.encode(HKDF_INFO), epkRaw, rpkRaw) },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const aadFor = kid => te.encode('cf1|' + ALG + '|' + kid);

export async function seal(recipientPublicRaw, obj) {
  const rpkRaw = b64uDecode(recipientPublicRaw);
  const rpk = await importPublicRaw(recipientPublicRaw);
  const kid = await kidOf(rpkRaw);
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const epkRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const key = await deriveAesKey(eph.privateKey, rpk, epkRaw, rpkRaw);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(kid) }, key, encodePadded(obj));
  return { v: 1, alg: ALG, kid, epk: b64uEncode(epkRaw), iv: b64uEncode(iv), ct: b64uEncode(ct) };
}

export async function open(envelope, privateKey, recipientPublicRaw) {
  if (!envelope || envelope.v !== 1 || envelope.alg !== ALG) throw new Error('bad-envelope');
  const rpkRaw = b64uDecode(recipientPublicRaw);
  if (envelope.kid !== await kidOf(rpkRaw)) throw new Error('wrong-key');
  const epkRaw = b64uDecode(envelope.epk);
  const epk = await importPublicRaw(envelope.epk);
  const key = await deriveAesKey(privateKey, epk, epkRaw, rpkRaw);
  let pt;
  try {
    pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64uDecode(envelope.iv), additionalData: aadFor(envelope.kid) }, key, b64uDecode(envelope.ct));
  } catch (_) { throw new Error('decrypt-failed'); }
  return decodeJson(new Uint8Array(pt));
}

/* ---------- passphrase protection of the private key ---------- */

async function passKey(passphrase, salt, iterations) {
  const base = await subtle.importKey('raw', te.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function wrapPrivateKey(privateKey, passphrase, kid, iterations = PBKDF2_ITERATIONS) {
  const pkcs8 = await subtle.exportKey('pkcs8', privateKey);
  const salt = randomBytes(16), iv = randomBytes(12);
  const k = await passKey(passphrase, salt, iterations);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('cf1|wrap|' + kid) }, k, pkcs8);
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, kid, salt: b64uEncode(salt), iv: b64uEncode(iv), ct: b64uEncode(ct) };
}

// Returns a NON-extractable private key: once unwrapped it can decrypt but never be exported again.
export async function unwrapPrivateKey(wrapped, passphrase) {
  if (!wrapped || wrapped.v !== 1 || wrapped.kdf !== 'PBKDF2-SHA256') throw new Error('bad-wrapped-key');
  const k = await passKey(passphrase, b64uDecode(wrapped.salt), wrapped.iter);
  let pkcs8;
  try {
    pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: b64uDecode(wrapped.iv), additionalData: te.encode('cf1|wrap|' + wrapped.kid) }, k, b64uDecode(wrapped.ct));
  } catch (_) { throw new Error('wrong-passphrase'); }
  return subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

/* ---------- symmetric (prefill carried by the link) ---------- */

export function newSymKey() { return randomToken(32); }

async function symKey(keyB64u) {
  const raw = b64uDecode(keyB64u);
  if (raw.length !== 32) throw new Error('bad-sym-key');
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealSym(keyB64u, obj, context) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('cf1|sym|' + context) }, await symKey(keyB64u), encodePadded(obj));
  return { v: 1, alg: SYM_ALG, iv: b64uEncode(iv), ct: b64uEncode(ct) };
}

export async function openSym(keyB64u, envelope, context) {
  if (!envelope || envelope.v !== 1 || envelope.alg !== SYM_ALG) throw new Error('bad-envelope');
  let pt;
  try {
    pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64uDecode(envelope.iv), additionalData: te.encode('cf1|sym|' + context) }, await symKey(keyB64u), b64uDecode(envelope.ct));
  } catch (_) { throw new Error('decrypt-failed'); }
  return decodeJson(new Uint8Array(pt));
}

/* ---------- form link ---------- */
// Everything sensitive travels in the URL fragment, which browsers never send to any server.
//   t = access token (server stores only its SHA-256)
//   k = coach public key (pins the recipient; a compromised host cannot swap it)
//   p = prefill key (decrypts the item list the coach attached)

export function buildFormLink(base, { token, publicRaw, prefillKey }) {
  const q = new URLSearchParams({ t: token, k: publicRaw });
  if (prefillKey) q.set('p', prefillKey);
  return base.replace(/#.*$/, '') + '#' + q.toString();
}

export function parseFormLink(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const token = q.get('t') || '', publicRaw = q.get('k') || '', prefillKey = q.get('p') || '';
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(token) || !/^[A-Za-z0-9_-]{87}$/.test(publicRaw)) return null;
  if (prefillKey && !/^[A-Za-z0-9_-]{43}$/.test(prefillKey)) return null;
  return { token, publicRaw, prefillKey: prefillKey || null };
}
