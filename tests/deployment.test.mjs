import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import handler from '../api/index.js';

test('static deployment assets exist and local imports resolve',async()=>{
  const html=await readFile('public/index.html','utf8');
  for(const m of html.matchAll(/(?:src|href)=["']\/([^"']+)["']/g)) await access(resolve('public',m[1]));
  for(const file of ['public/app.js','public/media.js']){
    const source=await readFile(file,'utf8'); assert.ok(source.length>100);
    for(const m of source.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) await access(resolve(dirname(file),m[1]));
  }
});

test('frontend uses Ibee branding and custom voice menu name',async()=>{
  const source=await readFile('public/app.js','utf8');
  assert.match(source,/Giọng Của Tôi/);
  assert.doesNotMatch(source,/Tên Giọng của Tôi/);
  assert.match(source,/Ibee/);
  assert.match(source,/admin-assign-voice/);
  assert.doesNotMatch(source,/Vbee|VBEE|Fish Audio|FISH FREE|Lip Sync|fish-handoff/);
});

test('Vercel config keeps Node API and static public output',async()=>{
  const config=JSON.parse(await readFile('vercel.json','utf8'));
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  assert.equal(config.outputDirectory,'public');
  assert.equal(config.buildCommand,'npm run build');
  assert.equal(pkg.engines.node,'22.x');
  assert.equal(typeof handler,'function');
});

test('admin voice assignment captures selected value before disabling the select',async()=>{
  const source=await readFile('public/app.js','utf8');
  assert.match(source,/const username=el\.dataset\.assignUser,voiceCode=el\.value;el\.disabled=true/);
  assert.doesNotMatch(source,/busy\(el,async\(\)=>\{await api\('admin-assign-voice'/);
});

test('Vbee integration matches current batch API contract',async()=>{
  const source=await readFile('lib/providers.mjs','utf8');
  assert.match(source,/https:\/\/api\.vbee\.vn\/v1\/tts/);
  assert.match(source,/https:\/\/api\.vbee\.vn\/v1\/tts\/requests/);
  assert.match(source,/'App-Id': key\('VBEE_APP_ID'\)/);
  assert.match(source,/process\.env\.VBEE_TOKEN \|\| process\.env\.VBEE_ACCESS_TOKEN/);
  for(const literal of [
    'text: script',
    'voiceCode: voice.code',
    "mode: 'async'",
    "outputFormat: 'mp3'",
    'webhookUrl:',
    'clientPause:'
  ]) assert.ok(source.includes(literal), 'missing Vbee field: '+literal);
  for(const legacy of ['input_text','voice_code','callback_url','speed_rate','app_id:']) assert.ok(!source.includes(legacy),'legacy Vbee field remains: '+legacy);
});


test('Ibee player uses authenticated same-origin audio proxy with range support',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const api=await readFile('api/index.js','utf8');
  const providers=await readFile('lib/providers.mjs','utf8');
  assert.match(frontend,/action=tts-audio&token=/);
  assert.match(frontend,/rec\.playUrl\|\|rec\.remoteUrl/);
  assert.match(api,/action === 'tts-audio'/);
  assert.match(api,/Accept-Ranges/);
  assert.match(api,/Content-Range/);
  assert.match(providers,/export async function vbeeAudio/);
  assert.match(providers,/redirect: 'follow'/);
});


test('member accounts cannot see or navigate to Settings',async()=>{
  const source=await readFile('public/app.js','utf8');
  assert.match(source,/const canOpenPage=page=>page!=='settings'\|\|S\.session\?\.role==='admin'/);
  assert.match(source,/filter\(\(\[p\]\)=>canOpenPage\(p\)\)/);
  assert.match(source,/!canOpenPage\(page\)/);
  assert.match(source,/if\(S\.session\.role==='admin'\)renderSettings\(\)/);
});


test('video voice clone module is integrated without FFmpeg or a new frontend framework',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const media=await readFile('public/media.js','utf8');
  const api=await readFile('api/index.js','utf8');
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  assert.match(frontend,/Clon giọng Video/);
  assert.match(frontend,/clone-transcribe/);
  assert.match(frontend,/clone-submit-video/);
  assert.match(media,/extractSpeechChunks/);
  assert.match(media,/composeAlignedSpeech/);
  assert.match(api,/clone-register-asset/);
  assert.match(api,/clone-video-status/);
  assert.deepEqual(pkg.dependencies||{},{});
  assert.doesNotMatch(JSON.stringify(pkg),/ffmpeg/i);
});
