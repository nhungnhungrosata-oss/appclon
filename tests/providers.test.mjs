import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal } from '../lib/core.mjs';
import { generateText, speech, analyze, googleStart, googleChunk, googleFile } from '../lib/providers.mjs';
process.env.SESSION_SECRET = 'test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_PASSWORD = 'test-only-password-123456'; process.env.APP_USERS_JSON = '{}';
for (const p of ['FISH','GOOGLE','OPENAI','DEEPSEEK']) process.env[`${p}_API_KEY`] = 'test-placeholder-not-a-real-key';
process.env.FISH_FREE_UNTIL = '2026-11-30';
for (const p of ['TEXT','ANALYSIS','TTS','UPLOAD']) { process.env[`DAILY_${p}_LIMIT`] = '500'; process.env[`GLOBAL_${p}_LIMIT`] = '500'; }
const originalFetch = global.fetch;
const response = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json', ...headers } });
async function mock(fn, body) { global.fetch = fn; try { return await body(); } finally { global.fetch = originalFetch; } }
const brief = { prompt: 'Write a Vietnamese narration from the supplied facts.', duration: 30 };

test('DeepSeek uses verified model, disabled thinking, real response; no fallback', async () => {
  await mock(async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); const b = JSON.parse(init.body);
    assert.equal(b.model, 'deepseek-flash'); assert.deepEqual(b.thinking, { type: 'disabled' });
    return response({ choices: [{ message: { content: 'Kich ban thu nghiem' }, finish_reason: 'stop' }], usage: { total_tokens: 5 } });
  }, async () => { const r = await generateText('admin', { ...brief, provider: 'deepseek' }); assert.equal(r.text, 'Kich ban thu nghiem'); });
});
test('OpenAI uses Responses API with no storage and parses text', async () => {
  await mock(async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); const b = JSON.parse(init.body);
    assert.equal(b.model, 'gpt-5.4-mini'); assert.equal(b.store, false); assert.equal(b.reasoning.effort, 'none');
    return response({ status: 'completed', output: [{ content: [{ type: 'output_text', text: 'Hello' }] }] });
  }, async () => assert.equal((await generateText('admin', { ...brief, provider: 'openai' })).text, 'Hello'));
});
test('provider 401 and truncated model output surface explicit errors without secret text', async () => {
  await mock(async () => response({ error: 'secret-key-do-not-leak' }, 401), async () => {
    await assert.rejects(() => generateText('admin', { ...brief, provider: 'openai' }), e => e.status === 502 && !e.message.includes('secret-key-do-not-leak'));
  });
  await mock(async () => response({ status: 'incomplete', output: [] }), async () => { await assert.rejects(() => generateText('admin', { ...brief, provider: 'openai' }), { status: 502 }); });
});
test('TTS hardcodes free model regardless of injected model and requests MP3', async () => {
  await mock(async (url, init) => {
    assert.equal(url, 'https://api.fish.audio/v1/tts'); assert.equal(init.headers.model, 's2.1-pro-free');
    const b = JSON.parse(init.body); assert.equal(b.format, 'mp3'); assert.equal(b.model, undefined);
    return new Response(Buffer.from('ID3test'), { headers: { 'content-type': 'audio/mpeg' } });
  }, async () => { const r = await speech('admin', { text: 'Xin chao', consent: true, model: 's2.1-pro' }); assert.equal(await r.text(), 'ID3test'); });
});
test('clone TTS uses MessagePack binary references, not JSON base64 audio', async () => {
  const b = Buffer.alloc(32044); b.write('RIFF'); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40);
  await mock(async (url, init) => {
    assert.equal(init.headers['Content-Type'], 'application/msgpack'); assert.ok(Buffer.isBuffer(init.body));
    assert.ok(init.body.includes(b)); assert.ok(init.body.includes(Buffer.from('references')));
    return new Response('ID3');
  }, () => speech('admin', { text: 'Xin chao', reference: b.toString('base64'), transcript: 'Exact words from sample', consent: true }));
});
test('consent must be explicit; missing credentials block before request', async () => {
  let called = false;
  await mock(async () => { called = true; }, async () => {
    await assert.rejects(() => speech('admin', { text: 'x', consent: false }), { status: 400 });
    const k = process.env.FISH_API_KEY; delete process.env.FISH_API_KEY;
    await assert.rejects(() => speech('admin', { text: 'x', consent: true }), { status: 503 }); process.env.FISH_API_KEY = k;
  }); assert.equal(called, false);
});
const analysis = { summary: 'Observed video content.', hook: 'Test hook', scenes: [{ time: '00:00', visual: 'A test frame', suggestion: 'A proposed cut' }], script: 'Test narration', warnings: [] };
test('Gemini receives actual JPEG frames, timestamps, no-audio constraints and JSON schema', async () => {
  await mock(async (url, init) => {
    assert.match(url, /gemini-2.5-flash-lite:generateContent/); const b = JSON.parse(init.body);
    assert.equal(b.contents[0].parts[1].inlineData.mimeType, 'image/jpeg'); assert.match(b.contents[0].parts.at(-1).text, /WITHOUT AUDIO/);
    assert.equal(b.generationConfig.thinkingConfig.thinkingBudget, 0);
    return response({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(analysis) }] } }], usageMetadata: { promptTokenCount: 100 } });
  }, async () => { const r = await analyze('admin', { mode: 'frames', duration: 3, consent: true, frames: [{ time: 0, data: Buffer.from([255,216,255,217]).toString('base64') }] }); assert.equal(r.script, analysis.script); assert.equal(r.mode, 'frames'); });
});
test('Gemini malformed or blocked results are never represented as success', async () => {
  const b = { mode: 'frames', duration: 3, consent: true, frames: [{ time: 0, data: '/9j/2Q==' }] };
  await mock(async () => response({ candidates: [{ finishReason: 'SAFETY' }] }), async () => assert.rejects(() => analyze('admin', b), { status: 502 }));
  await mock(async () => response({ candidates: [{ content: { parts: [{ text: 'not-json' }] } }] }), async () => assert.rejects(() => analyze('admin', b), { status: 502 }));
});
test('Google resumable upload is chunked, offset checked, owner bound, then deleted', async () => {
  let stage = 0;
  await mock(async (url, init) => {
    stage++;
    if (stage === 1) { assert.equal(init.headers['X-Goog-Upload-Protocol'], 'resumable'); return response({}, 200, { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/fake' }); }
    if (stage === 2) { assert.equal(init.headers['X-Goog-Upload-Offset'], '0'); assert.equal(init.headers['X-Goog-Upload-Command'], 'upload'); return response({}); }
    if (stage === 3) { assert.equal(init.headers['X-Goog-Upload-Offset'], String(2 * 1024 * 1024)); assert.equal(init.headers['X-Goog-Upload-Command'], 'upload, finalize'); return response({ file: { name: 'files/abc123', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123', state: 'ACTIVE' } }); }
    if (stage === 4) return response({ state: 'ACTIVE' });
    assert.equal(init.method, 'DELETE'); return response({});
  }, async () => {
    const s = await googleStart('admin', { size: 3 * 1024 * 1024, duration: 3, mime: 'video/mp4', consent: true });
    await assert.rejects(() => googleChunk('other', s.ticket, Buffer.alloc(s.chunkSize)), { status: 401 });
    const a = await googleChunk('admin', s.ticket, Buffer.alloc(s.chunkSize));
    const b = await googleChunk('admin', a.ticket, Buffer.alloc(1024 * 1024));
    assert.equal(unseal(b.fileToken, 'google-file', 'admin').mime, 'video/mp4');
    assert.equal((await googleFile('admin', b.fileToken)).state, 'ACTIVE'); assert.equal((await googleFile('admin', b.fileToken, true)).deleted, true);
  }); assert.equal(stage, 5);
});
test('native video analysis sends fileData only for active owner-bound files', async () => {
  const fileToken = seal('google-file', { user: 'admin', name: 'files/abc123', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123', mime: 'video/mp4' });
  let n = 0;
  await mock(async (url, init) => { if (++n === 1) return response({ state: 'ACTIVE' }); const b = JSON.parse(init.body); assert.equal(b.contents[0].parts[0].fileData.mimeType, 'video/mp4'); return response({ candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }] }); }, async () => { assert.equal((await analyze('admin', { mode: 'video', duration: 3, consent: true, fileToken })).mode, 'video'); });
});
