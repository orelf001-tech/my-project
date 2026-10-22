import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../shared/crypto.js';

const ITER = 1000; // fast for tests; production uses PBKDF2_ITERATIONS

test('seal/open round trip', async () => {
  const kp = await C.generateKeyPair();
  const msg = { name: 'דנה', sections: { inc: [{ label: 'משכורת', amount: 12500 }] } };
  const env = await C.seal(kp.publicRaw, msg);
  assert.equal(env.v, 1);
  assert.equal(env.alg, C.ALG);
  assert.equal(env.kid, kp.kid);
  assert.ok(!JSON.stringify(env).includes('דנה'));
  assert.deepEqual(await C.open(env, kp.privateKey, kp.publicRaw), msg);
});

test('ciphertext length is padded to 512-byte buckets', async () => {
  const kp = await C.generateKeyPair();
  const a = await C.seal(kp.publicRaw, { x: 'a' });
  const b = await C.seal(kp.publicRaw, { x: 'a'.repeat(300) });
  assert.equal(C.b64uDecode(a.ct).length, C.b64uDecode(b.ct).length);
});

test('every seal uses a fresh ephemeral key and iv', async () => {
  const kp = await C.generateKeyPair();
  const a = await C.seal(kp.publicRaw, { x: 1 }), b = await C.seal(kp.publicRaw, { x: 1 });
  assert.notEqual(a.epk, b.epk);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('tampering with any field is detected', async () => {
  const kp = await C.generateKeyPair();
  const env = await C.seal(kp.publicRaw, { amount: 100 });
  const flip = s => { const u = C.b64uDecode(s); u[u.length - 1] ^= 1; return C.b64uEncode(u); };
  await assert.rejects(C.open({ ...env, ct: flip(env.ct) }, kp.privateKey, kp.publicRaw), /decrypt-failed/);
  await assert.rejects(C.open({ ...env, iv: flip(env.iv) }, kp.privateKey, kp.publicRaw), /decrypt-failed/);
  const other = await C.generateKeyPair();
  await assert.rejects(C.open({ ...env, epk: other.publicRaw }, kp.privateKey, kp.publicRaw), /decrypt-failed/);
  await assert.rejects(C.open({ ...env, kid: other.kid }, kp.privateKey, kp.publicRaw), /wrong-key/);
  await assert.rejects(C.open({ ...env, v: 2 }, kp.privateKey, kp.publicRaw), /bad-envelope/);
});

test('another key cannot open the envelope', async () => {
  const kp = await C.generateKeyPair(), other = await C.generateKeyPair();
  const env = await C.seal(kp.publicRaw, { a: 1 });
  await assert.rejects(C.open(env, other.privateKey, kp.publicRaw), /decrypt-failed/);
});

test('private key wrap/unwrap with passphrase', async () => {
  const kp = await C.generateKeyPair();
  const w = await C.wrapPrivateKey(kp.privateKey, 'סיסמה ארוכה מאוד 123', kp.kid, ITER);
  assert.equal(w.iter, ITER);
  const pk = await C.unwrapPrivateKey(w, 'סיסמה ארוכה מאוד 123');
  assert.equal(pk.extractable, false);
  const env = await C.seal(kp.publicRaw, { ok: true });
  assert.deepEqual(await C.open(env, pk, kp.publicRaw), { ok: true });
  await assert.rejects(C.unwrapPrivateKey(w, 'wrong'), /wrong-passphrase/);
  await assert.rejects(C.unwrapPrivateKey({ ...w, kid: 'other' }, 'סיסמה ארוכה מאוד 123'), /wrong-passphrase/);
});

test('symmetric prefill round trip bound to context', async () => {
  const k = C.newSymKey();
  assert.equal(k.length, 43);
  const env = await C.sealSym(k, { name: 'רון' }, 'link-1');
  assert.deepEqual(await C.openSym(k, env, 'link-1'), { name: 'רון' });
  await assert.rejects(C.openSym(k, env, 'link-2'), /decrypt-failed/);
  await assert.rejects(C.openSym(C.newSymKey(), env, 'link-1'), /decrypt-failed/);
});

test('form link build/parse keeps secrets in the fragment', async () => {
  const kp = await C.generateKeyPair();
  const token = C.randomToken(), p = C.newSymKey();
  const url = C.buildFormLink('https://example.github.io/my-project/form/', { token, publicRaw: kp.publicRaw, prefillKey: p });
  const u = new URL(url);
  assert.equal(u.search, '');
  assert.deepEqual(C.parseFormLink(u.hash), { token, publicRaw: kp.publicRaw, prefillKey: p });
  assert.equal(C.parseFormLink('#t=short&k=' + kp.publicRaw), null);
  assert.equal(C.parseFormLink('#t=' + token + '&k=bad'), null);
  assert.equal(C.parseFormLink(''), null);
});

test('public key validation', async () => {
  await assert.rejects(C.importPublicRaw(C.b64uEncode(new Uint8Array(65))), /bad-public-key/);
  assert.throws(() => C.b64uDecode('a+b/'), /bad-base64/);
});

test('sha256Hex matches known vector', async () => {
  assert.equal(await C.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
