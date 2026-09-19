import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../api/index.js';
process.env.APP_PASSWORD = 'test-only-password-123456';
process.env.SESSION_SECRET = 'test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_USERS_JSON = '{}';
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
const fetchOriginal = global.fetch;
const server = createServer(handler);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie;
async function request(action, body, extra = {}) {
  return fetchOriginal(`${base}/api/index?action=${action}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test.after(() => new Promise(r => server.close(r)));
test('HTTP API requires login and same-origin POST', async () => {
  assert.equal((await request('session')).status, 401);
  assert.equal((await request('login', { username: 'admin', password: process.env.APP_PASSWORD }, { Origin: 'https://foreign.test' })).status, 403);
  assert.equal((await request('login', { username: 'admin', password: 'invalid' })).status, 401);
});
test('HTTP login cookie works and config never returns secrets', async () => {
  const r = await request('login', { username: 'admin', password: process.env.APP_PASSWORD });
  assert.equal(r.status, 200); cookie = r.headers.get('set-cookie').split(';')[0];
  const data = await (await request('session')).json(); assert.equal(data.username, 'admin'); assert.equal(data.models.fish, 's2.1-pro-free');
  assert.ok(!JSON.stringify(data).includes(process.env.SESSION_SECRET)); assert.ok(!JSON.stringify(data).includes(process.env.APP_PASSWORD));
});
test('HTTP missing API key and unknown route return actionable errors', async () => {
  delete process.env.OPENAI_API_KEY;
  const r = await request('text', { provider: 'openai', prompt: 'Write a script.' }); assert.equal(r.status, 503); assert.equal((await r.json()).code, 'MISSING_KEY');
  assert.equal((await request('unknown', {})).status, 404);
});
test('HTTP MP3 response forwards free-model header and enforces output cap', async () => {
  process.env.FISH_API_KEY = 'test-placeholder';
  try {
    global.fetch = async () => new Response(Buffer.from('ID3test'), { headers: { 'content-type': 'audio/mpeg' } });
    const good = await request('tts', { text: 'Xin chao', consent: true }); assert.equal(good.status, 200); assert.equal(good.headers.get('x-fish-model'), 's2.1-pro-free'); assert.equal(await good.text(), 'ID3test');
    global.fetch = async () => new Response(Buffer.alloc(3900001));
    const large = await request('tts', { text: 'Xin chao', consent: true }); assert.equal(large.status, 413); assert.match(large.headers.get('content-type'), /json/);
  } finally { global.fetch = fetchOriginal; }
});
test('HTTP session declares Fish web handoff and ignores legacy provider key', async () => {
  process.env.FAL_KEY = 'unused-test-only-legacy-key';
  try {
    const data = await (await request('session')).json();
    assert.equal(data.lipSync.provider, 'fish-audio');
    assert.equal(data.lipSync.mode, 'web-handoff');
    assert.equal(data.lipSync.apiIntegrated, false);
    assert.equal(data.lipSync.website, 'https://fish.audio/app/image-video/');
    assert.ok(!('fal' in data.providers));
    assert.ok(!JSON.stringify(data).includes(process.env.FAL_KEY));
  } finally { delete process.env.FAL_KEY; }
});
test('HTTP retired lip-sync routes return 410 without upstream calls', async () => {
  let calls = 0;
  try {
    global.fetch = async () => { calls++; throw new Error('No upstream allowed'); };
    for (const route of ['fal-upload', 'lip-submit', 'lip-status', 'lip-cancel']) {
      const r = await request(route, {});
      assert.equal(r.status, 410);
      assert.equal((await r.json()).code, 'LIPSYNC_WEB_ONLY');
    }
    assert.equal(calls, 0);
  } finally { global.fetch = fetchOriginal; }
});
test('HTTP logout clears cookie', async () => {
  const r = await request('logout', {}); assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});
