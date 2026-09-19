// Fish Creative handoff: local files only. No API, credentials, upload or job polling.
export const FISH_CREATIVE_URL = 'https://fish.audio/app/image-video/';
export const HANDOFF_PROVIDER = 'fish-creative-web';
const LIMIT = 80 * 1024 * 1024;
const EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/aac': 'aac' };
export function mediaFilename(record, prefix = 'source') {
  const extension = EXT[record?.blob?.type];
  if (!extension || !/^[a-z0-9-]+$/i.test(prefix)) throw new Error('File xuất không hợp lệ.');
  return `${prefix}.${extension}`;
}
export function validateHandoff(visual, audio) {
  for (const [record, kinds] of [[visual, ['image','video']], [audio, ['audio']]]) {
    if (!record || !kinds.includes(record.kind) || !(record.blob instanceof Blob)) throw new Error('Chọn ảnh/video và audio trước.');
    if (!record.blob.size || record.blob.size > LIMIT || !EXT[record.blob.type] || !record.blob.type.startsWith(`${record.kind}/`)) throw new Error('File không hợp lệ hoặc vượt 80 MB.');
    if (record.kind === 'image') {
      if (record.blob.size > 20 * 1024 * 1024) throw new Error('Ảnh tối đa 20 MB.');
    } else if (!Number.isFinite(record.duration) || record.duration < 0.1 || record.duration > 180) throw new Error('Video/audio cần dài 0,1-180 giây.');
  }
}
const encoder = new TextEncoder();
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
async function crc32(blob) {
  let crc = 0xffffffff;
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
    const chunk = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
    for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    // Yield to the browser between chunks; large video exports stay responsive.
    if (typeof window !== 'undefined') await new Promise(resolve => setTimeout(resolve, 0));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Minimal ZIP32 stored-file writer. No compression, network dependency, or ZIP64.
export async function zipStored(entries, progress = () => {}) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 20) throw new Error('Invalid ZIP entries.');
  let total = 0; const seen = new Set();
  for (const e of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(e.name) || !(e.blob instanceof Blob) || seen.has(e.name)) throw new Error('Unsafe or duplicate ZIP filename.');
    seen.add(e.name); total += e.blob.size;
  }
  if (total > 180 * 1024 * 1024) throw new Error('ZIP exceeds 180 MB.');
  const data = [], central = []; let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], filename = encoder.encode(e.name), crc = await crc32(e.blob);
    const h = new Uint8Array(30 + filename.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
    v.setUint16(12, 33, true); // DOS date: 1980-01-01; no misleading creation timestamp.
    v.setUint32(14, crc, true); v.setUint32(18, e.blob.size, true); v.setUint32(22, e.blob.size, true);
    v.setUint16(26, filename.length, true); h.set(filename, 30);
    data.push(h, e.blob);
    const c = new Uint8Array(46 + filename.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 33, true); cv.setUint32(16, crc, true); cv.setUint32(20, e.blob.size, true); cv.setUint32(24, e.blob.size, true);
    cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true); c.set(filename, 46); central.push(c);
    offset += h.length + e.blob.size; progress(i + 1, entries.length);
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, central.reduce((n, c) => n + c.length, 0), true); ev.setUint32(16, offset, true);
  return new Blob([...data, ...central, end], { type: 'application/zip' });
}
export async function buildHandoffBundle({ visual, audio, script = '', id, progress }) {
  validateHandoff(visual, audio);
  if (typeof id !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(id)) throw new Error('Invalid local project ID.');
  if (typeof script !== 'string' || script.length > 50000) throw new Error('Kịch bản quá dài.');
  const visualName = mediaFilename(visual, '01-source'), audioName = mediaFilename(audio, '02-voice');
  const manifest = { version: 1, projectId: id, provider: HANDOFF_PROVIDER, mode: 'manual-web-handoff', autoSubmitted: false, website: FISH_CREATIVE_URL,
    files: [{ filename: visualName, mime: visual.blob.type, size: visual.blob.size, duration: visual.duration ?? null }, { filename: audioName, mime: audio.blob.type, size: audio.blob.size, duration: audio.duration }] };
  const readme = `CLIPLAB - FISH CREATIVE\n\nGói này chỉ chứa tư liệu cục bộ, chưa gửi bất kỳ tác vụ AI nào.\n\n1. Giải nén gói này trên máy.\n2. Mở ${FISH_CREATIVE_URL} và đăng nhập Fish Audio.\n3. Chọn Lip Sync. Tải ${visualName} và ${audioName} lên Fish. KHÔNG tải cả ZIP.\n4. Xem số credit và thiết lập ngay trên Fish trước khi bấm Generate. Fish Free TTS không đồng nghĩa Lip Sync miễn phí.\n5. Tải video kết quả, quay lại ClipLab và chọn Nhập video kết quả.\n\nTên file giữ đúng codec/định dạng, không đổi WebM thành MP4 giả. Khi Fish không nhận định dạng, cần chuyển mã trước. Chỉ dùng giọng/hình đã được cho phép.\n\nMã dự án CỤC BỘ: ${id}\nĐây không phải job ID của Fish.\n`;
  const entries = [{ name: visualName, blob: visual.blob }, { name: audioName, blob: audio.blob },
    { name: '03-script.txt', blob: new Blob([script], { type: 'text/plain;charset=utf-8' }) },
    { name: 'READ_ME_VI.txt', blob: new Blob([readme], { type: 'text/plain;charset=utf-8' }) },
    { name: 'project.json', blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) }];
  return { blob: await zipStored(entries, progress), manifest };
}
