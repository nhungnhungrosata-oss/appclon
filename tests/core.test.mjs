import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { seal, unseal, hashPassword, verifyPassword, checkOrigin, readBody, readJson, sessionCookie, authenticate, publicError, users } from '../lib/core.mjs';
import { encode } from '../lib/msgpack.mjs';
import { checkFishFree, wavReference } from '../lib/providers.mjs';
import { get, set, limit, quota } from '../lib/store.mjs';
process.env.SESSION_SECRET = 'test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_PASSWORD = 'test-only-password-123456';
process.env.APP_USERS_JSON = '{}';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
const req = (body, type = 'application/json') => ({ headers: { 'content-type': type }, body });

test('signed tokens bind type, owner, expiration and reject tampering', () => {
  const token = seal('file', { user: 'alice', size: 100 });
  assert.equal(unseal(token, 'file', 'alice').size, 100);
  for (const fn of [() => unseal(token, 'job', 'alice'), () => unseal(token, 'file', 'bob'), () => unseal(token + 'x', 'file'), () => unseal(seal('file', {}, -1), 'file')]) assert.throws(fn, { status: 401 });
});
test('password hashes are salted scrypt and reject invalid password/hash', () => {
  const one = hashPassword('secret-123'), two = hashPassword('secret-123');
  assert.notEqual(one, two); assert.ok(verifyPassword('secret-123', one));
  assert.equal(verifyPassword('wrong', one), false); assert.equal(verifyPassword('secret-123', 'broken'), false);
});
test('session cookie is HttpOnly, Secure, SameSite and password rotation invalidates it', () => {
  const password = process.env.APP_PASSWORD;
  const cookie = sessionCookie('admin', { password }, true);
  assert.match(cookie, /HttpOnly; SameSite=Strict/); assert.match(cookie, /Secure/);
  assert.equal(authenticate({ headers: { cookie } }).username, 'admin');
  process.env.APP_PASSWORD += '-rotated'; assert.throws(() => authenticate({ headers: { cookie } }), { status: 401 });
  process.env.APP_PASSWORD = password;
});
test('same-origin writes required; cross-site and missing origin rejected', () => {
  checkOrigin({ headers: { host: 'example.test', origin: 'https://example.test', 'sec-fetch-site': 'same-origin' } });
  for (const headers of [{ host: 'x' }, { host: 'x', origin: 'https://evil.test' }, { host: 'x', origin: 'https://x', 'sec-fetch-site': 'cross-site' }]) assert.throws(() => checkOrigin({ headers }), { status: 403 });
});
test('body limits apply to pre-parsed objects, buffers, lengths and streams', async () => {
  assert.deepEqual(await readJson(req({ ok: true })), { ok: true });
  assert.equal((await readBody(req(Buffer.from('abc')), 3)).toString(), 'abc');
  await assert.rejects(() => readBody(req(Buffer.alloc(10)), 9), { status: 413 });
  await assert.rejects(() => readBody({ headers: { 'content-length': '999' } }, 10), { status: 413 });
  const stream = Readable.from([Buffer.alloc(8), Buffer.alloc(8)]); stream.headers = {};
  await assert.rejects(() => readBody(stream, 10), { status: 413 });
});
test('JSON rejects corrupt input, array, wrong content type and oversize', async () => {
  await assert.rejects(() => readJson(req('{')), { status: 400 });
  await assert.rejects(() => readJson(req('[]')), { status: 400 });
  await assert.rejects(() => readJson(req('{}', 'text/plain')), { status: 415 });
  await assert.rejects(() => readJson(req('{"x":12345}'), 5), { status: 413 });
});
test('internal error text never leaks API secrets', () => {
  const e = publicError(new Error('sk-sensitive-key')); assert.equal(e.status, 500); assert.ok(!e.error.includes('sk-sensitive-key'));
});
test('MessagePack supports binary, Unicode, maps, arrays, booleans and numbers', () => {
  assert.equal(encode({ a: Buffer.from([1, 2]) }).toString('hex'), '81a161c4020102');
  assert.equal(encode('ế').toString('hex'), 'a3e1babf');
  assert.equal(encode([null, true, false, 127]).toString('hex'), '94c0c3c27f');
  assert.equal(encode('x'.repeat(32)).subarray(0, 2).toString('hex'), 'd920');
  assert.equal(encode(Buffer.alloc(256)).subarray(0, 3).toString('hex'), 'c50100');
  assert.equal(encode(1.5).toString('hex'), 'cb3ff8000000000000');
});
test('Fish Free cutoff permits last day and fails closed on next day', () => {
  process.env.FISH_FREE_UNTIL = '2026-11-30';
  checkFishFree(new Date('2026-11-30T23:59:59Z'));
  assert.throws(() => checkFishFree(new Date('2026-12-01T00:00:00Z')), { status: 503 });
  process.env.FISH_FREE_UNTIL = 'invalid'; assert.throws(() => checkFishFree(), { status: 503 });
  process.env.FISH_FREE_UNTIL = '2026-11-30';
});
function wav() {
  const b = Buffer.alloc(32044); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40); return b;
}
test('clone sample only accepts normalized 1-45 second PCM WAV', () => {
  const b = wav(); assert.deepEqual(wavReference(b.toString('base64')), b);
  b.writeUInt16LE(2, 22); assert.throws(() => wavReference(b.toString('base64')), { status: 400 });
  assert.throws(() => wavReference('not base64!'), { status: 400 });
  assert.throws(() => wavReference(Buffer.alloc(1440045).toString('base64')), { status: 400 });
});
test('memory store supports get/set, expiry, NX and limits', async () => {
  assert.ok(await set('test:a', { x: 1 }, 30, true)); assert.equal(await set('test:a', {}, 30, true), false);
  assert.deepEqual(await get('test:a'), { x: 1 });
  await set('test:expired', 1, -1); assert.equal(await get('test:expired'), null);
  await limit('test:limit', 1, 30); await assert.rejects(() => limit('test:limit', 1, 30), { status: 429 });
});
test('multi-user AI jobs fail closed without shared Redis', async () => {
  process.env.APP_USERS_JSON = JSON.stringify({ alice: { passwordHash: hashPassword('long-password'), role: 'member' } });
  assert.equal(Object.keys(users()).length, 2);
  await assert.rejects(() => quota('alice', 'text'), { status: 503 }); process.env.APP_USERS_JSON = '{}';
});
