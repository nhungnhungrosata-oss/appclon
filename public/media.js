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
export async function sampleFrames(blob, duration, count = 24, progress = () => {}) {
  const video = document.createElement('video'); const url = URL.createObjectURL(blob);
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  try {
    const ready = event(video, 'loadeddata'); video.src = url; await ready;
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 448 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * ratio)); canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context || !video.videoWidth) throw new Error('Không giải mã được video.');
    count = Math.max(1, Math.min(48, count)); const frames = [];
    for (let i = 0; i < count; i++) {
      const time = Math.max(0, Math.min(duration - 0.06, count === 1 ? 0.01 : i / (count - 1) * (duration - 0.06)));
      if (Math.abs(video.currentTime - time) > 0.005) { const seek = event(video, 'seeked'); video.currentTime = time; await seek; }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
      frames.push({ time: Number(time.toFixed(3)), data }); progress(i + 1, count);
    }
    return frames;
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
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
export class Recorder {
  stream = null; recorder = null; recording = false;
  async open({ video = true, facing = 'user', portrait = false, audio = true } = {}) {
    this.close();
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Cần Chrome/Edge/Safari mới và HTTPS (hoặc localhost) để quay/thu.');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: video ? { facingMode: { ideal: facing }, width: { ideal: portrait ? 720 : 1280 }, height: { ideal: portrait ? 1280 : 720 }, frameRate: { ideal: 25, max: 30 } } : false, audio: audio ? { echoCancellation: video, noiseSuppression: video } : false });
    this.isVideo = video;
    return this.stream;
  }
  start(maxSeconds = 180, tick = () => {}) {
    if (!this.stream) throw new Error('Hãy mở camera/micro trước.');
    const choices = this.isVideo ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
    const mime = choices.find(x => MediaRecorder.isTypeSupported(x));
    this.recorder = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), ...(this.isVideo ? { videoBitsPerSecond: 1500000, audioBitsPerSecond: 96000 } : { audioBitsPerSecond: 128000 }) });
    this.chunks = []; this.recording = true; this.startedAt = performance.now();
    this.done = new Promise((resolve, reject) => {
      this.recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
      this.recorder.onerror = () => { this.recording = false; clearInterval(this.timer); this.close(); reject(new Error('Thiết bị dừng ghi hình/ghi âm.')); };
      this.recorder.onstop = () => {
        const duration = (performance.now() - this.startedAt) / 1000;
        const blob = new Blob(this.chunks, { type: this.recorder.mimeType.split(';')[0] });
        this.recording = false; clearInterval(this.timer); resolve({ blob, duration });
      };
    });
    this.recorder.start(1000);
    this.timer = setInterval(() => { const seconds = (performance.now() - this.startedAt) / 1000; tick(seconds); if (seconds >= maxSeconds) this.stop(); }, 200);
    return this.done;
  }
  stop() { if (this.recorder?.state === 'recording') this.recorder.stop(); return this.done; }
  close() { this.stop(); this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
}
