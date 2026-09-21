let database;
const objectUrls = new Map();
export async function initDB(username) {
  database?.close();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`cliplab-v1-${username}`, 1);
    request.onupgradeneeded = () => {
      for (const name of ['assets', 'voices', 'jobs']) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => { database = request.result; resolve(); };
    request.onerror = () => reject(new Error('Không mở được bộ nhớ trình duyệt. Hãy tắt chế độ riêng tư hoặc cho phép lưu trữ.'));
  });
}
function transaction(store, mode, fn) {
  if (!database) return Promise.reject(new Error('Chưa mở thư viện.'));
  return new Promise((resolve, reject) => {
    const t = database.transaction(store, mode);
    const r = fn(t.objectStore(store)); let value;
    r.onsuccess = () => { value = r.result; };
    t.oncomplete = () => resolve(value);
    t.onerror = t.onabort = () => reject(new Error('Không lưu được. Bộ nhớ trình duyệt có thể đã đầy; hãy tải file về máy.'));
  });
}
export const put = (store, data) => transaction(store, 'readwrite', s => s.put(data));
export const all = store => transaction(store, 'readonly', s => s.getAll()).then(rows => rows.sort((a, b) => b.createdAt - a.createdAt));
export const remove = (store, id) => transaction(store, 'readwrite', s => s.delete(id));
export const clear = store => transaction(store, 'readwrite', s => s.clear());
export function blobUrl(record) {
  if (!objectUrls.has(record.id)) objectUrls.set(record.id, URL.createObjectURL(record.blob));
  return objectUrls.get(record.id);
}
export function releaseUrls() { for (const u of objectUrls.values()) URL.revokeObjectURL(u); objectUrls.clear(); }
export function download(blob, filename) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const pause = ms => new Promise(r => setTimeout(r, ms));
function event(el, success, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('Không đọc được media. Thử MP4 H.264 hoặc WAV/MP3.')), timeout);
    const ok = () => done();
    const bad = () => done(new Error('Trình duyệt không hỗ trợ codec của file này.'));
    function done(error) { clearTimeout(timer); el.removeEventListener(success, ok); el.removeEventListener('error', bad); error ? reject(error) : resolve(); }
    el.addEventListener(success, ok, { once: true }); el.addEventListener('error', bad, { once: true });
  });
}
export function cleanMime(file) {
  const m = file.type?.split(';')[0];
  if (m) return m === 'audio/x-m4a' ? 'audio/mp4' : m;
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac' }[ext] || 'application/octet-stream';
}
export async function durationOf(blob, kind = 'video', hint = 0) {
  const media = document.createElement(kind); const url = URL.createObjectURL(blob);
  try {
    media.preload = 'metadata'; const ready = event(media, 'loadedmetadata'); media.src = url; await ready;
    if (Number.isFinite(media.duration) && media.duration > 0) return media.duration;
    if (hint > 0) return hint;
    const seek = event(media, 'seeked'); media.currentTime = 1e10; await seek;
    if (Number.isFinite(media.duration) && media.duration > 0) return media.duration;
    throw new Error('Không đọc được thời lượng. Chuyển video sang MP4 trước khi tải lên.');
  } finally { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); }
}
export async function createVideoThumbnail(blob, durationHint = 0) {
  if (!(blob instanceof Blob) || blob.size < 100) throw new Error('Video không hợp lệ.');
  const video = document.createElement('video');
  const url = URL.createObjectURL(blob);
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  try {
    const ready = event(video, 'loadeddata', 12000); video.src = url; await ready;
    if (!video.videoWidth || !video.videoHeight) throw new Error('Không đọc được hình video.');
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : durationHint;
    const long = Math.max(video.videoWidth, video.videoHeight);
    const scale = Math.min(1, 480 / long);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Không tạo được ảnh đại diện.');

    const end = Math.max(.05, Math.min(Number.isFinite(duration) ? duration - .05 : 1, 1.2));
    const times = [...new Set([.04, .22, .55, 1].map(t => Number(Math.min(end, t).toFixed(3))))].filter(t => t >= 0);
    let best = null;
    for (const time of times) {
      await seekVideo(video, time);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0, sum2 = 0, samples = 0;
      const step = Math.max(4, Math.floor(data.length / 12000 / 4) * 4);
      for (let i = 0; i < data.length; i += step) {
        const y = data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722;
        sum += y; sum2 += y * y; samples++;
      }
      const mean = sum / Math.max(1, samples);
      const variance = Math.max(0, sum2 / Math.max(1, samples) - mean * mean);
      const score = Math.sqrt(variance) - Math.abs(mean - 125) * .08;
      if (!best || score > best.score) {
        const image = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Không tạo được ảnh đại diện.')), 'image/jpeg', .8));
        best = { score, image };
      }
    }
    return best?.image || await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Không tạo được ảnh đại diện.')), 'image/jpeg', .8));
  } finally {
    video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  }
}

function clampScene(v,min,max){return Math.max(min,Math.min(max,v))}
function medianScene(values){
  if(!values.length)return 0;
  const a=[...values].sort((x,y)=>x-y),mid=Math.floor(a.length/2);
  return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;
}
function sceneSignature(ctx,w,h){
  const {data}=ctx.getImageData(0,0,w,h);
  const hist=new Float32Array(32),blocks=new Float32Array(4*4*3);
  const counts=new Uint16Array(16);
  for(let y=0;y<h;y++){
    const by=Math.min(3,Math.floor(y/h*4));
    for(let x=0;x<w;x++){
      const p=(y*w+x)*4,r=data[p],g=data[p+1],b=data[p+2];
      const l=(r*0.2126+g*0.7152+b*0.0722);
      hist[Math.min(31,Math.floor(l/8))]++;
      const bx=Math.min(3,Math.floor(x/w*4)),bi=by*4+bx;
      blocks[bi*3]+=r;blocks[bi*3+1]+=g;blocks[bi*3+2]+=b;counts[bi]++;
    }
  }
  const pixels=Math.max(1,w*h);
  for(let i=0;i<hist.length;i++)hist[i]/=pixels;
  for(let i=0;i<16;i++){
    const n=Math.max(1,counts[i])*255;
    blocks[i*3]/=n;blocks[i*3+1]/=n;blocks[i*3+2]/=n;
  }
  return {hist,blocks};
}
function sceneDistance(a,b){
  let hist=0,block=0;
  for(let i=0;i<a.hist.length;i++)hist+=Math.abs(a.hist[i]-b.hist[i]);
  hist*=0.5;
  for(let i=0;i<a.blocks.length;i++)block+=Math.abs(a.blocks[i]-b.blocks[i]);
  block/=a.blocks.length;
  return clampScene(hist*0.62+block*0.38,0,1);
}
async function seekVideo(video,time){
  const t=Math.max(0,Math.min(Math.max(0,video.duration-0.04),time));
  if(Math.abs(video.currentTime-t)<=0.012)return;
  const done=event(video,'seeked',12000);video.currentTime=t;await done;
}
export async function detectSceneFrames(blob,duration,progress=()=>{},options={}){
  const video=document.createElement('video'),url=URL.createObjectURL(blob);
  video.muted=true;video.playsInline=true;video.preload='auto';
  try{
    const ready=event(video,'loadeddata');video.src=url;await ready;
    if(!video.videoWidth||!video.videoHeight)throw new Error('Không giải mã được video.');
    const actual=Number.isFinite(video.duration)&&video.duration>0?video.duration:duration;
    if(!Number.isFinite(actual)||actual<=0||actual>180.5)throw new Error('Video cần dài tối đa 3 phút.');

    const scan=document.createElement('canvas'),long=Math.max(video.videoWidth,video.videoHeight);
    const scanScale=Math.min(1,96/long);
    scan.width=Math.max(24,Math.round(video.videoWidth*scanScale));
    scan.height=Math.max(24,Math.round(video.videoHeight*scanScale));
    const scanCtx=scan.getContext('2d',{willReadFrequently:true});
    if(!scanCtx)throw new Error('Không tạo được bộ phát hiện chuyển cảnh.');

    const interval=actual<=30?.35:actual<=90?.55:.8;
    const times=[];for(let t=.01;t<actual-.04;t+=interval)times.push(t);
    if(!times.length)times.push(.01);
    const finalTime=Math.max(.01,actual-.05);
    if(finalTime-times.at(-1)>interval*.4)times.push(finalTime);
    const points=[];let previous=null;
    for(let i=0;i<times.length;i++){
      await seekVideo(video,times[i]);
      scanCtx.drawImage(video,0,0,scan.width,scan.height);
      const sig=sceneSignature(scanCtx,scan.width,scan.height);
      const delta=previous?sceneDistance(previous,sig):1;
      points.push({time:times[i],sig,delta});previous=sig;
      progress(i+1,times.length,'scan');
    }

    const deltas=points.slice(1).map(x=>x.delta);
    const med=medianScene(deltas);
    const mad=medianScene(deltas.map(x=>Math.abs(x-med)));
    const sensitivity=options.sensitivity==='high'?.85:options.sensitivity==='strict'?1.18:1;
    const threshold=clampScene((med+Math.max(.055,mad*3.2))*sensitivity,.13,.34);
    const minGap=Math.max(.7,interval*1.15);
    const candidates=[];
    for(let i=1;i<points.length;i++){
      const p=points[i],prev=points[i-1],next=points[i+1];
      const localMax=!next||p.delta>=next.delta*.94;
      if(p.delta>=threshold&&localMax&&(!candidates.length||p.time-candidates.at(-1).time>=minGap)){
        candidates.push({...p,score:p.delta});
      }else if(candidates.length&&p.delta>=threshold*1.45&&p.time-candidates.at(-1).time<minGap&&p.delta>candidates.at(-1).score){
        candidates[candidates.length-1]={...p,score:p.delta};
      }
    }

    const maxFrames=Math.max(2,Math.min(36,Number(options.maxFrames)||28));
    let selected=[{...points[0],score:1},...candidates];
    if(selected.length>maxFrames){
      const first=selected[0],rest=selected.slice(1).sort((a,b)=>b.score-a.score).slice(0,maxFrames-1);
      selected=[first,...rest].sort((a,b)=>a.time-b.time);
    }

    const render=document.createElement('canvas'),scale=Math.min(1,512/long);
    render.width=Math.max(1,Math.round(video.videoWidth*scale));
    render.height=Math.max(1,Math.round(video.videoHeight*scale));
    const renderCtx=render.getContext('2d');
    if(!renderCtx)throw new Error('Không tạo được frame phân tích.');
    const frames=[];
    for(let i=0;i<selected.length;i++){
      await seekVideo(video,selected[i].time);
      renderCtx.drawImage(video,0,0,render.width,render.height);
      const data=render.toDataURL('image/jpeg',.66).split(',')[1];
      frames.push({time:Number(selected[i].time.toFixed(3)),data,sceneScore:Number(selected[i].score.toFixed(4))});
      progress(i+1,selected.length,'render');
    }
    return {
      frames,
      scanned:points.length,
      interval:Number(interval.toFixed(2)),
      threshold:Number(threshold.toFixed(4))
    };
  }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url)}
}
export async function audioReference(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Mẫu giọng tối đa 25 MB.');
  const Audio = window.AudioContext || window.webkitAudioContext;
  const audio = new Audio();
  try {
    const source = await audio.decodeAudioData(await file.arrayBuffer());
    const seconds = Math.min(45, source.duration);
    if (seconds < 1) throw new Error('Mẫu giọng cần tối thiểu 1 giây.');
    const ctx = new OfflineAudioContext(1, Math.floor(seconds * 16000), 16000);
    const node = ctx.createBufferSource(); node.buffer = source; node.connect(ctx.destination); node.start(0, 0, seconds);
    const normalized = await ctx.startRendering(); const samples = normalized.getChannelData(0);
    const buffer = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(buffer);
    const str = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767), true));
    return { blob: new Blob([buffer], { type: 'audio/wav' }), duration: seconds, trimmed: source.duration > 45 };
  } finally { await audio.close(); }
}
export function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
  });
}

function wavMono(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (offset, value) => [...value].forEach((ch, n) => view.setUint8(offset + n, ch.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let n = 0; n < samples.length; n++) {
    const v = Math.max(-1, Math.min(1, samples[n]));
    view.setInt16(44 + n * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function extractSpeechChunks(mediaBlob, chunkSeconds = 40, progress = () => {}) {
  if (!(mediaBlob instanceof Blob) || mediaBlob.size < 100) throw new Error('Video nguồn không hợp lệ.');
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio || !window.OfflineAudioContext) throw new Error('Trình duyệt chưa hỗ trợ xử lý audio. Hãy dùng Chrome/Edge mới.');
  const audio = new Audio();
  try {
    let source;
    try { source = await audio.decodeAudioData(await mediaBlob.arrayBuffer()); }
    catch { throw new Error('Không tách được tiếng từ video. Hãy dùng MP4 H.264 + AAC hoặc WebM có audio.'); }
    if (!Number.isFinite(source.duration) || source.duration < 0.2 || source.duration > 180.5) throw new Error('Video cần có tiếng và dài tối đa 3 phút.');
    const sampleRate = 16000;
    const frames = Math.max(1, Math.ceil(source.duration * sampleRate));
    const offline = new OfflineAudioContext(1, frames, sampleRate);
    const node = offline.createBufferSource(); node.buffer = source; node.connect(offline.destination); node.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const perChunk = Math.floor(chunkSeconds * sampleRate);
    const chunks = [];
    for (let start = 0, index = 0; start < samples.length; start += perChunk, index++) {
      const end = Math.min(samples.length, start + perChunk);
      const copy = new Float32Array(end - start); copy.set(samples.subarray(start, end));
      chunks.push({
        index,
        offset: Number((start / sampleRate).toFixed(3)),
        duration: Number(((end - start) / sampleRate).toFixed(3)),
        blob: wavMono(copy, sampleRate)
      });
      progress(end, samples.length);
    }
    return { chunks, duration: source.duration };
  } finally { await audio.close(); }
}

export async function composeAlignedSpeech(items, totalDuration, progress = () => {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('Chưa có audio giọng mới.');
  if (!Number.isFinite(totalDuration) || totalDuration <= 0 || totalDuration > 180.5) throw new Error('Thời lượng video không hợp lệ.');
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio || !window.OfflineAudioContext) throw new Error('Trình duyệt chưa hỗ trợ dựng audio.');
  const decode = new Audio();
  try {
    const sampleRate = 44100;
    const offline = new OfflineAudioContext(1, Math.ceil(totalDuration * sampleRate), sampleRate);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!(item.blob instanceof Blob) || !Number.isFinite(item.start) || item.start < 0 || item.start >= totalDuration) throw new Error('Timeline audio không hợp lệ.');
      const buffer = await decode.decodeAudioData(await item.blob.arrayBuffer());
      const node = offline.createBufferSource(); node.buffer = buffer; node.connect(offline.destination); node.start(item.start);
      progress(index + 1, items.length);
    }
    const result = await offline.startRendering();
    const samples = new Float32Array(result.length); samples.set(result.getChannelData(0));
    return { blob: wavMono(samples, sampleRate), duration: totalDuration, sampleRate };
  } finally { await decode.close(); }
}

export async function mediaDuration(blob, kind = 'audio') {
  return durationOf(blob, kind);
}

export async function trimSpeechAudio(blob, {
  floor = 0.0025,
  relative = 0.02,
  frameMs = 10,
  padMs = 35
} = {}) {
  if (!(blob instanceof Blob) || blob.size < 32) throw new Error('Audio Ibee không hợp lệ.');
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) throw new Error('Trình duyệt chưa hỗ trợ phân tích audio.');
  const ctx = new Audio();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = decoded.numberOfChannels;
    const length = decoded.length;
    const rate = decoded.sampleRate;
    if (!length || !Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('Không đọc được audio Ibee.');

    const mono = new Float32Array(length);
    let peak = 0;
    for (let ch = 0; ch < channels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(mono[i]));
    if (peak < 1e-5) throw new Error('Audio Ibee không có tiếng.');

    const threshold = Math.max(floor, peak * relative);
    const frame = Math.max(32, Math.floor(rate * frameMs / 1000));
    let first = -1, last = -1;
    for (let start = 0; start < length; start += frame) {
      const end = Math.min(length, start + frame);
      let sum = 0;
      for (let i = start; i < end; i++) sum += mono[i] * mono[i];
      const rms = Math.sqrt(sum / Math.max(1, end - start));
      if (rms >= threshold) {
        if (first < 0) first = start;
        last = end;
      }
    }
    if (first < 0 || last <= first) return { blob, duration: decoded.duration, trimmed: false, leading: 0, trailing: 0 };

    const pad = Math.floor(rate * padMs / 1000);
    const start = Math.max(0, first - pad);
    const end = Math.min(length, last + pad);
    const samples = new Float32Array(end - start);
    samples.set(mono.subarray(start, end));
    const leading = start / rate;
    const trailing = (length - end) / rate;
    const duration = samples.length / rate;
    const materiallyTrimmed = leading > 0.03 || trailing > 0.03;
    return {
      blob: materiallyTrimmed ? wavMono(samples, rate) : blob,
      duration,
      trimmed: materiallyTrimmed,
      leading,
      trailing
    };
  } finally {
    await ctx.close();
  }
}

function waitMedia(el, event, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Trình duyệt tải media quá chậm.')); }, timeout);
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('Không đọc được video/audio nguồn.')); };
    const cleanup = () => { clearTimeout(timer); el.removeEventListener(event, ok); el.removeEventListener('error', bad); };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

function recorderMime() {
  const choices = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return choices.find(x => MediaRecorder.isTypeSupported(x)) || '';
}

export async function replaceVideoAudio(videoBlob, audioBlob, expectedDuration, progress = () => {}) {
  if (!(videoBlob instanceof Blob) || !(audioBlob instanceof Blob)) throw new Error('Video/audio đầu vào không hợp lệ.');
  if (!window.MediaRecorder || !window.MediaStream) throw new Error('Trình duyệt chưa hỗ trợ ghép audio vào video. Hãy dùng Chrome/Edge mới.');
  if (!Number.isFinite(expectedDuration) || expectedDuration < 0.2 || expectedDuration > 180.5) throw new Error('Thời lượng video không hợp lệ.');

  const videoUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.src = videoUrl; video.muted = true; video.playsInline = true; video.preload = 'auto';
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) { URL.revokeObjectURL(videoUrl); throw new Error('Trình duyệt chưa hỗ trợ AudioContext.'); }

  let audioContext, captured, canvasStream, outputStream, recorder, audioSource, drawFrameId;
  try {
    await waitMedia(video, 'loadedmetadata');
    if (!video.videoWidth || !video.videoHeight) throw new Error('Video nguồn không có hình ảnh hợp lệ.');

    audioContext = new Audio();
    const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
    if (Math.abs(audioBuffer.duration - expectedDuration) > 0.35) throw new Error('Audio timeline lệch thời lượng video. Hãy tạo lại giọng.');

    const dest = audioContext.createMediaStreamDestination();
    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(dest);

    const nativeCapture = video.captureStream?.bind(video) || video.mozCaptureStream?.bind(video);
    let videoTracks = [];
    if (nativeCapture) {
      captured = nativeCapture();
      videoTracks = captured.getVideoTracks();
    }

    if (!videoTracks.length) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (!ctx || !canvas.captureStream) throw new Error('Trình duyệt không hỗ trợ capture video.');
      const fps = 30;
      canvasStream = canvas.captureStream(fps);
      videoTracks = canvasStream.getVideoTracks();
      let stopped = false;
      const draw = () => {
        if (stopped) return;
        if (video.readyState >= 2) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if ('requestVideoFrameCallback' in video) drawFrameId = video.requestVideoFrameCallback(draw);
        else drawFrameId = requestAnimationFrame(draw);
      };
      draw();
      video.__stopCloneDraw = () => {
        stopped = true;
        if ('cancelVideoFrameCallback' in video && typeof drawFrameId === 'number') video.cancelVideoFrameCallback(drawFrameId);
        else if (typeof drawFrameId === 'number') cancelAnimationFrame(drawFrameId);
      };
    }

    if (!videoTracks.length || !dest.stream.getAudioTracks().length) throw new Error('Không tạo được media stream để ghép video.');
    outputStream = new MediaStream([...videoTracks, ...dest.stream.getAudioTracks()]);

    const mime = recorderMime();
    const pixels = video.videoWidth * video.videoHeight;
    const videoBitsPerSecond = Math.min(12_000_000, Math.max(2_500_000, Math.round(pixels * 3)));
    recorder = new MediaRecorder(outputStream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond,
      audioBitsPerSecond: 160000
    });

    const chunks = [];
    const recorded = new Promise((resolve, reject) => {
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      recorder.onerror = () => reject(new Error('Trình duyệt lỗi khi xuất video mới.'));
      recorder.onstop = () => {
        const type = (recorder.mimeType || mime || 'video/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        if (!blob.size) return reject(new Error('Video kết quả bị rỗng.'));
        resolve({ blob, mime: type, extension: type.includes('mp4') ? 'mp4' : 'webm', width: video.videoWidth, height: video.videoHeight });
      };
    });

    await audioContext.resume();
    video.currentTime = 0;
    if (video.readyState < 2) await waitMedia(video, 'canplay');
    progress(0, expectedDuration);
    recorder.start(1000);

    const started = performance.now();
    const timer = setInterval(() => {
      const elapsed = Math.min(expectedDuration, Math.max(video.currentTime || 0, (performance.now() - started) / 1000));
      progress(elapsed, expectedDuration);
    }, 250);

    const ended = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Xuất video vượt thời gian cho phép.')), Math.ceil((expectedDuration + 20) * 1000));
      video.addEventListener('ended', () => { clearTimeout(timeout); resolve(); }, { once: true });
      video.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Video nguồn dừng phát khi đang xuất.')); }, { once: true });
    });

    audioSource.start();
    await video.play();
    await ended;
    clearInterval(timer);
    progress(expectedDuration, expectedDuration);
    await new Promise(r => setTimeout(r, 120));
    if (recorder.state !== 'inactive') recorder.stop();
    const result = await recorded;
    result.duration = expectedDuration;
    return result;
  } finally {
    try { video.pause(); } catch {}
    try { video.__stopCloneDraw?.(); } catch {}
    try { if (recorder?.state && recorder.state !== 'inactive') recorder.stop(); } catch {}
    try { audioSource?.stop(); } catch {}
    try { outputStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { captured?.getTracks().forEach(t => t.stop()); } catch {}
    try { canvasStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { await audioContext?.close(); } catch {}
    URL.revokeObjectURL(videoUrl);
  }
}
export class Recorder {
  stream = null; rawStream = null; recorder = null; recording = false;
  portrait = false; facing = 'user'; audioEnabled = true; isVideo = true;
  sourceVideo = null; canvas = null; canvasStream = null; frameHandle = null; drawContext = null;

  videoConstraints(facing = this.facing) {
    return {
      facingMode: { ideal: facing },
      width: { ideal: this.portrait ? 720 : 1280 },
      height: { ideal: this.portrait ? 1280 : 720 },
      aspectRatio: { ideal: this.portrait ? 9 / 16 : 16 / 9 },
      frameRate: { ideal: 25, max: 30 }
    };
  }

  async attachSource(stream) {
    if (!this.sourceVideo) throw new Error('Camera chưa sẵn sàng.');
    const source = this.sourceVideo;
    const ready = event(source, 'loadedmetadata', 12000);
    source.srcObject = new MediaStream(stream.getVideoTracks());
    await source.play().catch(() => {});
    await ready;
    if (!source.videoWidth || !source.videoHeight) throw new Error('Không đọc được kích thước camera.');
  }

  restartDrawLoop() {
    try {
      if (this.sourceVideo && 'cancelVideoFrameCallback' in this.sourceVideo && typeof this.frameHandle === 'number') this.sourceVideo.cancelVideoFrameCallback(this.frameHandle);
      else if (typeof this.frameHandle === 'number') cancelAnimationFrame(this.frameHandle);
    } catch {}
    this.frameHandle = null;
    this.drawFrame();
  }

  drawCover(source, ctx, width, height) {
    const sw = source.videoWidth, sh = source.videoHeight;
    const targetRatio = width / height;
    const sourceRatio = sw / sh;
    let sx = 0, sy = 0, cw = sw, ch = sh;
    if (sourceRatio > targetRatio) {
      cw = sh * targetRatio;
      sx = (sw - cw) / 2;
    } else if (sourceRatio < targetRatio) {
      ch = sw / targetRatio;
      sy = (sh - ch) / 2;
    }
    ctx.drawImage(source, sx, sy, cw, ch, 0, 0, width, height);
  }

  drawNaturalPortrait(source, ctx, canvas) {
    const sw = source.videoWidth, sh = source.videoHeight;
    const containScale = Math.min(canvas.width / sw, canvas.height / sh);
    const coverScale = Math.max(canvas.width / sw, canvas.height / sh);

    // Fill the 9:16 canvas with a soft background, then draw the real camera
    // frame with only a small maximum zoom. This keeps people at a natural
    // distance instead of center-cropping a 16:9 source until it looks close.
    ctx.save();
    ctx.filter = 'blur(28px) brightness(0.5)';
    this.drawCover(source, ctx, canvas.width, canvas.height);
    ctx.restore();
    ctx.fillStyle = 'rgba(8,9,13,.16)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const naturalScale = Math.min(coverScale, containScale * 1.18);
    const dw = sw * naturalScale, dh = sh * naturalScale;
    const dx = (canvas.width - dw) / 2, dy = (canvas.height - dh) / 2;
    ctx.drawImage(source, dx, dy, dw, dh);
  }

  drawFrame() {
    const source = this.sourceVideo, canvas = this.canvas, ctx = this.drawContext;
    if (!source || !canvas || !ctx) return;
    if (source.videoWidth && source.videoHeight && source.readyState >= 2) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (this.portrait) this.drawNaturalPortrait(source, ctx, canvas);
      else this.drawCover(source, ctx, canvas.width, canvas.height);
    }
    if ('requestVideoFrameCallback' in source) this.frameHandle = source.requestVideoFrameCallback(() => this.drawFrame());
    else this.frameHandle = requestAnimationFrame(() => this.drawFrame());
  }

  async open({ video = true, facing = 'user', portrait = false, audio = true } = {}) {
    this.close();
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Cần Chrome/Edge/Safari mới và HTTPS (hoặc localhost) để quay/thu.');
    this.isVideo = video;
    this.portrait = !!(video && portrait);
    this.facing = facing === 'environment' ? 'environment' : 'user';
    this.audioEnabled = !!audio;

    if (!video) {
      this.rawStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      this.stream = this.rawStream;
      return this.stream;
    }

    if (!document.createElement('canvas').captureStream) throw new Error('Trình duyệt này chưa hỗ trợ ghi hình ổn định. Hãy dùng Chrome hoặc Edge mới.');

    const audioConstraints = audio ? { echoCancellation: true, noiseSuppression: true } : false;
    try {
      this.rawStream = await navigator.mediaDevices.getUserMedia({
        video: { ...this.videoConstraints(this.facing), facingMode: { exact: this.facing } },
        audio: audioConstraints
      });
    } catch {
      this.rawStream = await navigator.mediaDevices.getUserMedia({
        video: this.videoConstraints(this.facing),
        audio: audioConstraints
      });
    }

    const source = document.createElement('video');
    source.muted = true; source.playsInline = true; source.autoplay = true;
    this.sourceVideo = source;
    await this.attachSource(this.rawStream);

    const canvas = document.createElement('canvas');
    canvas.width = this.portrait ? 720 : 1280;
    canvas.height = this.portrait ? 1280 : 720;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Không tạo được khung hình camera.');

    this.canvas = canvas; this.drawContext = ctx;
    this.restartDrawLoop();

    this.canvasStream = canvas.captureStream(30);
    const videoTrack = this.canvasStream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('Không tạo được stream ghi hình.');

    this.stream = new MediaStream([videoTrack, ...this.rawStream.getAudioTracks()]);
    return this.stream;
  }

  start(maxSeconds = 180, tick = () => {}) {
    if (!this.stream) throw new Error('Hãy mở camera/micro trước.');
    const choices = this.isVideo ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
    const mime = choices.find(x => MediaRecorder.isTypeSupported(x));
    const videoBitsPerSecond = this.portrait ? 2600000 : 2200000;
    this.recorder = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), ...(this.isVideo ? { videoBitsPerSecond, audioBitsPerSecond: 96000 } : { audioBitsPerSecond: 128000 }) });
    this.chunks = []; this.recording = true; this.startedAt = performance.now();
    this.done = new Promise((resolve, reject) => {
      this.recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
      this.recorder.onerror = () => { this.recording = false; clearInterval(this.timer); this.close(); reject(new Error('Thiết bị dừng ghi hình/ghi âm.')); };
      this.recorder.onstop = () => {
        const duration = (performance.now() - this.startedAt) / 1000;
        const blob = new Blob(this.chunks, { type: this.recorder.mimeType.split(';')[0] });
        this.recording = false; clearInterval(this.timer);
        resolve({ blob, duration, width: this.portrait ? 720 : 1280, height: this.portrait ? 1280 : 720, portrait: this.portrait });
      };
    });
    this.recorder.start(1000);
    this.timer = setInterval(() => { const seconds = (performance.now() - this.startedAt) / 1000; tick(seconds); if (seconds >= maxSeconds) this.stop(); }, 200);
    return this.done;
  }

  stop() {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    return this.done;
  }

  close() {
    this.stop();
    try {
      if (this.sourceVideo && 'cancelVideoFrameCallback' in this.sourceVideo && typeof this.frameHandle === 'number') this.sourceVideo.cancelVideoFrameCallback(this.frameHandle);
      else if (typeof this.frameHandle === 'number') cancelAnimationFrame(this.frameHandle);
    } catch {}
    this.frameHandle = null;
    try { this.sourceVideo?.pause(); } catch {}
    if (this.sourceVideo) this.sourceVideo.srcObject = null;
    this.canvasStream?.getTracks().forEach(t => t.stop());
    this.stream?.getTracks().forEach(t => t.stop());
    this.rawStream?.getTracks().forEach(t => t.stop());
    this.stream = null; this.rawStream = null; this.canvasStream = null; this.sourceVideo = null; this.canvas = null; this.drawContext = null;
  }
}
