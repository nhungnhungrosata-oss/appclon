import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import handler from '../api/index.js';

test('static deployment assets exist and local imports resolve',async()=>{
  const html=await readFile('public/index.html','utf8');
  for(const m of html.matchAll(/(?:src|href)=["']\/([^"']+)["']/g)) await access(resolve('public',m[1].split('?')[0]));
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


test('video voice clone replaces audio locally without lip-sync provider or FFmpeg',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const media=await readFile('public/media.js','utf8');
  const api=await readFile('api/index.js','utf8');
  const env=await readFile('.env.example','utf8');
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  assert.match(frontend,/Clon giọng Video/);
  assert.match(frontend,/clone-transcribe/);
  assert.match(frontend,/replaceVideoAudio/);
  assert.match(media,/export async function replaceVideoAudio/);
  assert.match(media,/MediaRecorder/);
  assert.match(media,/captureStream/);
  assert.doesNotMatch(frontend,/clone-submit-video|clone-register-asset|SYNC_API_KEY|lipsync-2|lip-sync/i);
  assert.doesNotMatch(api,/clone-submit-video|clone-register-asset|SYNC_API_KEY/);
  assert.doesNotMatch(env,/SYNC_API_KEY|SYNC_LIPSYNC_MODEL/);
  assert.deepEqual(pkg.dependencies||{},{});
  assert.doesNotMatch(JSON.stringify(pkg),/ffmpeg/i);
});


test('admin UI shows only a masked OpenAI key fingerprint',async()=>{
  const source=await readFile('public/app.js','utf8');
  assert.match(source,/OpenAI key production đang đọc/);
  assert.match(source,/oa\.hint/);
  assert.doesNotMatch(source,/OPENAI_API_KEY\}\}/);
});


test('clone final render cannot require removed Sync API and core assets bypass stale cache',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const html=await readFile('public/index.html','utf8');
  const config=JSON.parse(await readFile('vercel.json','utf8'));
  const renderBlock=frontend.slice(frontend.indexOf('async function renderCloneVideo'),frontend.indexOf('function renderSettings'));
  assert.match(frontend,/Ghép video hoàn chỉnh/);
  assert.doesNotMatch(frontend,/Tạo video hoàn chỉnh/);
  assert.doesNotMatch(renderBlock,/ensureProvider\(['"]sync['"]\)|clone-submit-video|clone-video-status|SYNC_API_KEY/);
  assert.match(renderBlock,/replaceVideoAudio/);
  assert.match(html,/app\.js\?v=[A-Za-z0-9._-]+/);
  assert.match(html,/styles\.css\?v=[A-Za-z0-9._-]+/);
  for(const path of ['/','/index.html','/app.js','/media.js','/styles.css']){
    const rule=config.headers.find(x=>x.source===path);
    assert.ok(rule,'missing no-store rule for '+path);
    assert.ok(rule.headers.some(h=>h.key==='Cache-Control'&&/no-store/.test(h.value)));
  }
});


test('clone timing uses active speech, adaptive speed and tight per-segment tolerance',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const media=await readFile('public/media.js','utf8');
  assert.match(frontend,/trimSpeechAudio/);
  assert.match(frontend,/initialSpeed=1/);
  assert.match(frontend,/calibratedSpeed=1/);
  assert.match(frontend,/target\*\.025/);
  assert.match(frontend,/target\*\.045/);
  assert.match(frontend,/normalizeCloneSegments\(rows,words,source\.duration\)/);
  assert.match(frontend,/splitLongCloneSegment/);
  assert.doesNotMatch(frontend,/ratio>1\.04\|\|ratio<0\.82/);
  assert.match(media,/export async function trimSpeechAudio/);
  assert.match(media,/rms >= threshold/);
});


test('camera recorder uses a fixed canvas output for true 16:9 and 9:16 recording',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const media=await readFile('public/media.js','utf8');
  const css=await readFile('public/styles.css','utf8');
  assert.match(media,/canvas\.width = this\.portrait \? 720 : 1280/);
  assert.match(media,/canvas\.height = this\.portrait \? 1280 : 720/);
  assert.match(media,/const targetRatio = canvas\.width \/ canvas\.height/);
  assert.match(media,/canvas\.captureStream\(30\)/);
  assert.match(media,/this\.stream = new MediaStream\(\[videoTrack, \.\.\.this\.rawStream\.getAudioTracks\(\)\]\)/);
  assert.match(media,/videoBitsPerSecond = this\.portrait \? 2600000 : 2200000/);
  assert.match(frontend,/Camera dọc 9:16 đã sẵn sàng/);
  assert.match(frontend,/applyCameraRatioUI/);
  assert.match(css,/\.camera-box\.portrait\{[^}]*aspect-ratio:9\/16/);
});




test('video analysis uses smart scene-change frames and DeepSeek Vision only',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const media=await readFile('public/media.js','utf8');
  const providers=await readFile('lib/providers.mjs','utf8');
  const api=await readFile('api/index.js','utf8');
  const env=await readFile('.env.example','utf8');
  assert.match(frontend,/detectSceneFrames/);
  assert.match(frontend,/Phân tích video/);
  assert.match(frontend,/scene-sensitivity/);
  assert.match(frontend,/mode:'scene_frames'/);
  assert.doesNotMatch(frontend,/analysis-mode|frame-count|google-start|google-file|Google Gemini/);
  assert.match(media,/export async function detectSceneFrames/);
  assert.match(media,/sceneSignature/);
  assert.match(media,/sceneDistance/);
  assert.match(media,/medianScene/);
  assert.match(media,/mad\*3\.2/);
  assert.match(media,/localMax/);
  assert.match(media,/maxFrames/);
  assert.match(providers,/DEEPSEEK_VISION_MODEL/);
  assert.match(providers,/type: 'image_url'/);
  assert.match(providers,/response_format: \{ type: 'json_object' \}/);
  assert.match(providers,/thinking: \{ type: 'disabled' \}/);
  assert.doesNotMatch(providers,/generativelanguage\.googleapis|GOOGLE_API_KEY|googleGenerateAnalysis|googleStart|googleChunk|googleFile/);
  assert.doesNotMatch(api,/google-start|google-chunk|google-file|google-delete|GOOGLE_API_KEY/);
  assert.doesNotMatch(env,/GOOGLE_API_KEY|GOOGLE_MODEL/);
  assert.match(env,/DEEPSEEK_VISION_MODEL=deepseek-flash/);
});


test('media page uses verified multi-strategy front/rear camera switching',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const media=await readFile('public/media.js','utf8');
  assert.match(frontend,/id="switch-camera"/);
  assert.match(frontend,/S\.camera\.switchFacing\(next\)/);
  assert.match(frontend,/Đã chuyển sang camera sau/);
  assert.match(media,/async videoInputs\(\)/);
  assert.match(media,/enumerateDevices\(\)/);
  assert.match(media,/videoInputCandidates\(devices, currentId, facing\)/);
  assert.match(media,/async tryApplyFacing\(next\)/);
  assert.match(media,/applyConstraints\(\{ facingMode: \{ exact: next \} \}\)/);
  assert.match(media,/deviceId: \{ exact: device\.deviceId \}/);
  assert.match(media,/facingMode: \{ exact: facing \}/);
  assert.match(media,/trackMatchesFacing/);
  assert.match(media,/oldVideoTracks\.forEach\(t => t\.stop\(\)\)/);
  assert.match(media,/await this\.waitCameraRelease\(320\)/);
  assert.match(media,/this\.sourceVideo\.srcObject = null/);
  assert.match(media,/restartDrawLoop\(\)/);
  assert.match(media,/camera_switch_failed/);
  const releaseAt=media.indexOf('oldVideoTracks.forEach(t => t.stop())');
  const waitAt=media.indexOf('await this.waitCameraRelease(320)',releaseAt);
  const acquireAt=media.indexOf('await this.acquireVideoCandidates',waitAt);
  assert.ok(releaseAt>=0&&waitAt>releaseAt&&acquireAt>waitAt,'camera must be detached, released, then reacquired');
  assert.match(media,/this\.stream = new MediaStream\(\[videoTrack, \.\.\.this\.rawStream\.getAudioTracks\(\)\]\)/);
  assert.match(media,/canvas\.width = this\.portrait \? 720 : 1280/);
  assert.match(media,/canvas\.height = this\.portrait \? 1280 : 720/);
});

test('media page hides provider branding and detailed analysis output',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const start=frontend.indexOf('function mediaMarkup(){');
  const end=frontend.indexOf('function scriptMarkup(){',start);
  const mediaMarkup=frontend.slice(start,end);
  assert.doesNotMatch(mediaMarkup,/DeepSeek|Lấy frame thông minh|Kết quả phân tích|analysis-summary|analysis-scenes|analysis-script/);
  assert.match(mediaMarkup,/Phân tích kịch bản/);
  assert.match(mediaMarkup,/Phân tích video/);
  assert.match(mediaMarkup,/id="analysis-complete"/);
  assert.match(mediaMarkup,/Tiếp tục sang Viết kịch bản/);
  assert.match(frontend,/\$\('#analysis-go-script'\)\.onclick=\(\)=>navigate\('script'\)/);
});

test('video library persists clear thumbnail images and backfills older videos',async()=>{
  const frontend=await readFile('public/app.js','utf8');
  const media=await readFile('public/media.js','utf8');
  const css=await readFile('public/styles.css','utf8');
  assert.match(media,/export async function createVideoThumbnail/);
  assert.match(media,/Math\.sqrt\(variance\)/);
  assert.match(frontend,/thumbnail=await createVideoThumbnail/);
  assert.match(frontend,/async function ensureVideoThumbnails/);
  assert.match(frontend,/ensureVideoThumbnails\(\)\.then/);
  assert.match(frontend,/asset-thumb/);
  assert.match(frontend,/<img src=/);
  assert.match(css,/\.asset-thumb video,\.asset-thumb img/);
});
