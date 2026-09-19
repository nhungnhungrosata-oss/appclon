import { initDB, put, all, remove, clear, blobUrl, releaseUrls, download, pause, cleanMime, durationOf, sampleFrames, audioReference, toBase64, Recorder } from './media.js';
import { FISH_CREATIVE_URL, HANDOFF_PROVIDER, buildHandoffBundle, mediaFilename, validateHandoff } from './fish-handoff.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  camera: '<path d="M14 5l-2-2H8L6 5H3a1 1 0 00-1 1v13a1 1 0 001 1h18a1 1 0 001-1V6a1 1 0 00-1-1z"/><circle cx="12" cy="12" r="4"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="3"/><path d="M16 10l6-3v10l-6-3z"/>',
  pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8"/>',
  magic: '<path d="M4 20L17 7M14 4l6 6M5 2v4M3 4h4M19 15v6M16 18h6"/>',
  settings: '<path d="M12 3l2 3 4-1 1 4 3 3-3 2-1 4-4-1-2 3-2-3-4 1-1-4-3-2 3-3 1-4 4 1z"/><circle cx="12" cy="12" r="3"/>',
  upload: '<path d="M12 16V3M7 8l5-5 5 5M3 15v5a1 1 0 001 1h16a1 1 0 001-1v-5"/>',
  down: '<path d="M12 3v13M7 11l5 5 5-5M3 16v4h18v-4"/>',
  play: '<path d="M7 3l14 9-14 9z"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  arrow: '<path d="M3 12h17M14 6l6 6-6 6"/>',
  folder: '<path d="M3 4h6l3 3h9v13H3z"/>',
  logout: '<path d="M9 3H3v18h6M9 12h13M17 7l5 5-5 5"/>',
  shield: '<path d="M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z"/><path d="M8 12l3 3 5-6"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  trash: '<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  refresh: '<path d="M20 7a9 9 0 10.5 10M20 2v6h-6"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.magic}</svg>`;
const logo = '<img class="logo-icon" src="/favicon.svg" alt="">';
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const size = bytes => (bytes / 1024 / 1024).toFixed(1) + ' MB';
const S = { session: null, page: 'media', assets: [], voices: [], jobs: [], selectedVideo: null, selectedVoice: '', camera: new Recorder(), mic: new Recorder(), progress: new Set() };
const pages = { media: 'Tư liệu video', script: 'Viết kịch bản', voice: 'Giọng nói AI', lip: 'Lip-sync studio', settings: 'Thiết lập' };
let toastTimer;
function toast(message, error = false) {
  const box = $('#toast'); box.textContent = message; box.classList.toggle('error', error); box.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, error ? 11000 : 5500);
}
async function api(action, body, options = {}) {
  const init = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(65000) };
  if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
  Object.assign(init, options);
  const r = await fetch(`/api/index?action=${encodeURIComponent(action)}`, init);
  if (!r.ok) {
    let data; try { data = await r.json(); } catch { data = {}; }
    const error = new Error(data.error || `Máy chủ trả lỗi HTTP ${r.status}.`); error.status = r.status; error.code = data.code; throw error;
  }
  return r.headers.get('content-type')?.startsWith('audio/') ? r.blob() : r.json();
}
async function busy(button, task, statusSelector) {
  if (!button || S.progress.has(button)) return;
  S.progress.add(button); const previous = button.innerHTML; button.disabled = true; button.innerHTML = '<span class="spinner"></span> Đang xử lý';
  try { await task(); }
  catch (error) {
    const message = error.name === 'TimeoutError' ? 'Yêu cầu hết thời gian. Không tự gửi lại tác vụ tính phí.' : error.message || 'Không thể xử lý.';
    toast(message, true); if (statusSelector && $(statusSelector)) $(statusSelector).textContent = message;
  } finally { S.progress.delete(button); button.disabled = false; button.innerHTML = previous; }
}
function draftKey() { return `cliplab-draft-${S.session.username}`; }
function saveDraft() {
  try { localStorage.setItem(draftKey(), JSON.stringify({ prompt: $('#script-prompt').value, script: $('#script-editor').value, voice: $('#voice-text').value, brief: $('#analysis-brief').value })); } catch { toast('Không lưu được bản nháp; hãy xuất TXT.', true); }
}
function loginScreen() {
  $('#app').hidden = true; $('#login-screen').hidden = false;
  $('#login-screen').innerHTML = `<div class="login-wrap"><div class="login-intro"><div class="brand">${logo}<div><strong>cliplab<span class="hero-accent">.</span></strong><small>AI CREATOR STUDIO</small></div></div><span class="eyebrow">YOUR CONTENT. YOUR VOICE.</span><h1>Biến ý tưởng thành<br><span class="hero-accent">video của riêng bạn.</span></h1><p>Quay tư liệu, phân tích bằng AI, viết kịch bản và lồng giọng clone. Một quy trình sáng tạo liền mạch.</p><div class="row"><span class="pill green">${icon('shield')} API key ở máy chủ</span><span class="pill purple">Fish Free</span></div></div><form class="login-card" id="login-form"><h2>Chào mừng trở lại</h2><p>Đăng nhập studio của bạn để bắt đầu.</p><div class="field"><label for="username">Tên đăng nhập</label><input id="username" autocomplete="username" value="admin" required maxlength="50"></div><div class="field"><label for="password">Mật khẩu</label><input id="password" autocomplete="current-password" type="password" required maxlength="500" placeholder="Nhập mật khẩu studio"></div><button class="primary full" type="submit" id="login-btn">Vào studio ${icon('arrow')}</button><p id="login-error" class="login-error" role="alert"></p><div class="divider"></div><p class="tiny muted">Lần đầu cài đặt? Chạy <code>npm run setup</code>, sau đó thêm API key vào biến môi trường. Không nhập API key vào mật khẩu.</p></form></div>`;
  $('#login-form').addEventListener('submit', e => {
    e.preventDefault(); $('#login-error').textContent = '';
    busy($('#login-btn'), async () => { await api('login', { username: $('#username').value, password: $('#password').value }); await boot(); }, '#login-error');
  });
}
function mediaMarkup() {
  return `<div class="hero"><div><span class="eyebrow">CREATE SOMETHING ORIGINAL</span><h1>Từ video thô đến <span class="hero-accent">nội dung có chất.</span></h1><p>Bắt đầu từ một video. Để AI giúp bạn tìm câu chuyện và viết kịch bản.</p></div><span class="pill">${icon('folder')} Thư viện trên thiết bị</span></div>
  <div class="workflow">${[['media','video','01. Tư liệu','Quay hoặc tải video'],['script','pen','02. Kịch bản','Phân tích & sáng tạo'],['voice','mic','03. Giọng nói','Clone & tạo lời đọc'],['lip','magic','04. Lip-sync','Khớp miệng & xuất video']].map(([page,ico,title,sub]) => `<button data-page="${page}" class="${page === 'media' ? 'current' : ''}"><span class="step-icon">${icon(ico)}</span><span><strong>${title}</strong><small>${sub}</small></span></button>`).join('')}</div>
  <div class="media-columns"><section class="panel"><div class="panel-head"><h2>Studio ghi hình</h2><span class="pill green"><span class="dot"></span> QUAY TẠI CHỖ</span></div><div class="camera-controls"><select id="camera-facing" aria-label="Camera"><option value="user">Camera trước</option><option value="environment">Camera sau</option></select><select id="camera-ratio" aria-label="Tỷ lệ quay"><option value="landscape">Ngang 16:9</option><option value="portrait">Dọc 9:16</option></select><label class="check"><input type="checkbox" id="camera-audio" checked> Micro</label></div><div class="camera-box"><video id="camera-video" playsinline muted></video><div class="camera-empty" id="camera-empty"><span class="camera-symbol">${icon('video')}</span><strong>Mỗi video bắt đầu từ bạn</strong><p>Mở camera để quay tư liệu<br>hoặc tải video có sẵn bên dưới.</p></div><span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span><span id="record-time" class="rec-badge" hidden>REC 00:00</span></div><div class="row between camera-actions"><div class="row"><button id="open-camera" class="primary">${icon('camera')} Mở camera</button><button id="start-record" disabled>${icon('play')} Quay</button><button id="stop-record" class="danger" hidden>${icon('stop')} Dừng</button><button id="close-camera" class="small subtle" hidden>Đóng</button></div><span class="tiny muted">Tối đa 3 phút</span></div><div class="dropzone" id="video-drop"><div class="row">${icon('upload')}<div><strong>Kéo thả video vào đây</strong><p>MP4, WebM, MOV · Tối đa 80 MB / 3 phút</p></div></div><button class="small" id="choose-video">Chọn file</button><input id="video-file" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" hidden></div><p id="camera-status" class="status-line" aria-live="polite"></p></section>
  <section class="panel analysis-panel"><div class="panel-head"><div class="row"><span class="ai-mark">${icon('magic')}</span><h2>AI nhìn video</h2></div><span class="pill purple">GEMINI</span></div><p class="tiny muted" id="google-model-label"></p><div class="divider"></div><div class="source-label" id="analysis-source">Chưa chọn video. Quay mới hoặc chọn từ thư viện.</div><div class="mode-grid"><label class="mode"><input type="radio" name="analysis-mode" value="frames" checked><strong>Tiết kiệm</strong><small>AI xem khung hình lấy mẫu.<br>Không gửi âm thanh.</small></label><label class="mode"><input type="radio" name="analysis-mode" value="video"><strong>Video đầy đủ</strong><small>Gửi file qua Google Files.<br>Có thể kèm âm thanh.</small></label></div><div class="field" id="frame-field"><label for="frame-count">Số khung hình lấy mẫu</label><select id="frame-count"><option value="12">12 khung · tiết kiệm nhất</option><option value="24" selected>24 khung · cân bằng</option><option value="48">48 khung · chi tiết hơn</option></select></div><div class="field"><label for="analysis-brief">Bạn muốn kể câu chuyện gì?</label><textarea id="analysis-brief" rows="3" maxlength="6000" placeholder="Ví dụ: Phân tích các cảnh và viết lời dẫn giới thiệu sản phẩm, giọng tự nhiên..."></textarea></div><label class="check"><input id="analysis-consent" type="checkbox">Tôi có quyền sử dụng video và đồng ý gửi dữ liệu cho Google. Free tier có thể dùng dữ liệu để cải thiện sản phẩm.</label><button id="analyze-btn" class="purple full">${icon('magic')} Phân tích kịch bản</button><p id="analysis-status" class="status-line" aria-live="polite"></p><div class="progress" id="analysis-progress" hidden><div></div></div></section></div>
  <section id="analysis-result" class="panel result" hidden><div class="panel-head"><h2>Kết quả phân tích</h2><button id="analysis-to-script" class="small primary">Sửa kịch bản ${icon('arrow')}</button></div><div id="analysis-summary" class="result-summary"></div><div id="analysis-warnings" class="notice"></div><div id="analysis-scenes" class="scene-list"></div><div class="divider"></div><div class="field"><label for="analysis-script">Lời dẫn AI đề xuất</label><textarea id="analysis-script" rows="5"></textarea></div><p class="tiny muted" id="analysis-usage"></p></section>
  <div class="library-heading"><h2>Thư viện tư liệu <span id="video-count" class="pill">0</span></h2><span class="tiny muted">Lưu cục bộ · không tự tải lên cloud</span></div><div id="video-library" class="asset-grid"></div>`;
}
function scriptMarkup() {
  return `<div class="hero"><div><span class="eyebrow">FIND YOUR STORY</span><h1>Viết nội dung. <span class="hero-accent">Giữ chất riêng.</span></h1><p>Chọn DeepSeek hoặc OpenAI, tạo lời dẫn rồi chỉnh sửa trước khi đọc.</p></div></div><div class="grid2"><section class="panel"><div class="panel-head"><h2>Brief sáng tạo</h2>${icon('pen')}</div><div class="grid2"><div class="field"><label for="text-provider">Nhà cung cấp</label><select id="text-provider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option></select><small id="text-model-label"></small></div><div class="field"><label for="script-duration">Thời lượng mục tiêu</label><select id="script-duration"><option value="30">30 giây</option><option value="60" selected>60 giây</option><option value="90">90 giây</option><option value="180">3 phút</option></select></div></div><div class="field"><label for="script-style">Phong cách</label><select id="script-style"><option>Tự nhiên, gần gũi</option><option>Giới thiệu sản phẩm rõ ràng</option><option>Kể chuyện, cảm xúc</option><option>Hướng dẫn, giải thích</option><option>Quảng cáo ngắn, mở đầu thu hút</option></select></div><div class="field"><label for="script-prompt">Nội dung & thông tin đã kiểm chứng</label><textarea id="script-prompt" rows="8" maxlength="10000" placeholder="Sản phẩm là gì? Khách hàng nào? Điểm nổi bật, giá bán thật và lời kêu gọi hành động..."></textarea></div><label class="check"><input id="include-analysis" type="checkbox" checked>Thêm phân tích video đang chọn làm tư liệu.</label><p class="tiny muted">Nội dung sẽ được gửi cho nhà cung cấp AI đã chọn. Chi phí API tách biệt với gói chat trên website.</p><div class="divider"></div><button id="generate-script" class="primary full">${icon('magic')} Tạo kịch bản</button><p id="script-status" class="status-line" aria-live="polite"></p></section><section class="panel"><div class="panel-head"><h2>Bản thảo của bạn</h2><span class="pill">Tự lưu</span></div><div class="field"><label for="script-editor">Lời nói hoàn chỉnh</label><textarea id="script-editor" class="script-area" rows="16" placeholder="Kịch bản sẽ xuất hiện ở đây. Bạn cũng có thể tự viết hoặc dán nội dung."></textarea></div><div class="row between"><span class="char-count" id="script-count">0 ký tự</span><button id="export-script" class="small">${icon('down')} Xuất TXT</button></div><div class="divider"></div><button id="script-to-voice" class="purple full">Tạo giọng từ kịch bản ${icon('arrow')}</button><p class="tiny muted status-line">Kiểm tra tính chính xác trước khi phát hành.</p></section></div>`;
}
function voiceMarkup() {
  return `<div class="hero"><div><span class="eyebrow">SOUND LIKE YOURSELF</span><h1>Một giọng nói. <span class="hero-accent">Nhiều câu chuyện.</span></h1><p>Clone tức thời từ mẫu giọng bằng Fish Audio. Không cần huấn luyện model riêng.</p></div><span class="pill green">S2.1 PRO FREE</span></div><div class="notice warning" id="fish-notice"></div><div class="divider"></div><div class="grid2"><section class="panel"><div class="panel-head"><h2>Thư viện giọng clone</h2>${icon('mic')}</div><p class="tiny muted">Mẫu giọng được lưu trên thiết bị. Chỉ gửi sang Fish khi bấm tạo giọng nói.</p><div class="divider"></div><div class="field"><label for="voice-name">Tên giọng</label><input id="voice-name" placeholder="Giọng của tôi" maxlength="80"></div><div class="field"><label for="reference-file">Tải mẫu giọng</label><input id="reference-file" type="file" accept="audio/*"><small>Giọng sạch, một người, không nhạc. App chuẩn hóa WAV mono 16 kHz và chỉ giữ tối đa 45 giây đầu.</small></div><div class="row"><button id="mic-record" class="small">${icon('mic')} Thu mẫu trực tiếp</button><button id="mic-stop" class="small danger" hidden>${icon('stop')} Dừng thu</button><span id="mic-time" class="tiny muted"></span></div><audio id="reference-preview" controls hidden></audio><p id="reference-info" class="status-line"></p><div class="field"><label for="reference-transcript">Nguyên văn đã nói trong mẫu</label><textarea id="reference-transcript" rows="4" maxlength="6000" placeholder="Chép đúng lời trong phần mẫu đã giữ lại. Không dán kịch bản mới vào đây."></textarea><small>Không tự gọi API chép lời để tránh phát sinh phí khác.</small></div><label class="check"><input type="checkbox" id="clone-consent">Đây là giọng của tôi hoặc người đã đồng ý cho clone và sử dụng.</label><button id="save-voice" class="primary full">${icon('check')} Lưu mẫu clone</button><div class="divider"></div><div id="voice-library" class="stack"></div></section><section class="panel"><div class="panel-head"><h2>Tạo giọng nói</h2><span class="pill green">FREE MODEL ONLY</span></div><div class="field"><label for="voice-select">Giọng sử dụng</label><select id="voice-select"><option value="">Giọng mặc định Fish</option></select></div><div class="field"><label for="voice-text">Văn bản cần đọc</label><textarea id="voice-text" rows="10" maxlength="3000" placeholder="Dán văn bản hoặc chuyển từ mục Kịch bản..."></textarea><small id="voice-count">0 / 3.000 ký tự</small></div><div class="field"><label for="voice-speed">Tốc độ đọc</label><select id="voice-speed"><option value="0.85">Chậm · 0,85x</option><option value="1" selected>Tự nhiên · 1x</option><option value="1.15">Nhanh · 1,15x</option></select></div><label class="check"><input id="tts-consent" type="checkbox">Tôi có quyền sử dụng văn bản/giọng này và đồng ý gửi cho Fish Audio. Bản free có thể lưu dữ liệu để cải thiện model.</label><button id="generate-voice" class="purple full">${icon('mic')} Tạo audio bằng Fish Free</button><p id="voice-status" class="status-line" aria-live="polite"></p><div id="audio-output" class="audio-output" hidden><div class="row between"><h3>Audio đã tạo</h3><span id="audio-duration" class="pill green"></span></div><audio id="tts-preview" controls></audio><div class="row"><button id="download-audio" class="small">${icon('down')} Tải MP3</button><button id="voice-to-lip" class="small primary">Dùng cho lip-sync ${icon('arrow')}</button></div></div></section></div>`;
}
function lipMarkup() {
  return `<div class="hero"><div><span class="eyebrow">FISH CREATIVE WORKFLOW</span><h1>Giọng của bạn. <span class="hero-accent">Lip Sync trên Fish.</span></h1><p>Chuẩn bị tư liệu tại đây, tạo video trên Fish Creative, rồi nhập kết quả về studio.</p></div><span class="pill purple">FISH AUDIO</span></div>
  <div class="notice warning"><strong>Chế độ chuyển tư liệu qua web — chưa tích hợp API Lip Sync.</strong><br>App không tự gửi job, không theo dõi tiến độ Fish và không trừ credit. Bạn tải tư liệu lên và bấm Generate trực tiếp trên Fish Creative.</div><div class="divider"></div>
  <div class="grid2"><section class="panel"><div class="panel-head"><h2>01. Chuẩn bị hình & giọng</h2>${icon('video')}</div>
  <div class="field"><label for="lip-video">Ảnh hoặc video nhân vật</label><select id="lip-video"></select><small>Chọn tư liệu có sẵn hoặc thêm ảnh/video. Chọn khuôn mặt rõ, miệng không bị che.</small></div>
  <div class="field"><label for="lip-visual-upload">Thêm ảnh / video từ máy</label><input id="lip-visual-upload" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.m4v"><small>Ảnh JPG/PNG/WebP: tối đa 20 MB. Video: tối đa 80 MB / 3 phút. Chỉ lưu cục bộ.</small></div>
  <video id="lip-source-preview" class="lip-preview" controls playsinline hidden></video><img id="lip-image-preview" class="lip-preview lip-image" alt="Ảnh nhân vật đã chọn" hidden>
  <div class="field"><label for="lip-audio">Giọng đọc sử dụng</label><select id="lip-audio"></select><small>Chọn MP3 Fish đã tạo hoặc tải âm thanh riêng.</small></div>
  <div class="field"><label for="lip-audio-upload">Thêm MP3 / WAV / M4A</label><input id="lip-audio-upload" type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/aac,.m4a,.mp3,.wav"><small>Tối đa 80 MB / 3 phút.</small></div><audio id="lip-audio-preview" controls hidden></audio>
  <div class="notice" id="lip-source-info">Chọn hình và giọng để xuất tư liệu.</div><div class="divider"></div>
  <label class="check"><input id="lip-consent" type="checkbox">Tôi có quyền sử dụng hình ảnh và giọng nói này.</label>
  <button id="generate-lip" class="primary full">${icon('down')} Tải gói tư liệu ZIP</button>
  <div class="row lip-download-row"><button class="small" id="lip-download-visual">${icon('down')} Hình / video</button><button class="small" id="lip-download-audio">${icon('down')} Audio</button></div>
  <p class="tiny muted">Gói ZIP chứa hình/video, audio, kịch bản hiện tại và hướng dẫn. Giải nén trước khi tải các file lên Fish. Không kèm API key hay mẫu clone gốc.</p><p id="lip-status" class="status-line" aria-live="polite"></p></section>
  <section class="panel"><div class="panel-head"><h2>02. Tạo trên Fish Creative</h2><span class="pill">TRÊN WEB FISH</span></div>
  <p class="steps-text">Mở Fish → đăng nhập → chọn <strong>Lip Sync</strong> → thêm hình/video và audio → kiểm tra credit → Generate.</p>
  <a id="open-fish-creative" class="btn primary full" href="${FISH_CREATIVE_URL}" target="_blank" rel="noopener noreferrer">Mở Fish Creative ${icon('arrow')}</a>
  <p class="tiny muted status-line">Mở tab Fish không tự chuyển file hay đăng nhập. Dùng tài khoản Fish của bạn; app không nhận cookie/mật khẩu Fish.</p>
  <div class="notice warning"><strong>Fish Free TTS không đồng nghĩa Lip Sync miễn phí.</strong> Credit và giá tạo video xem ngay trên Fish trước khi xác nhận. ClipLab không ước tính giá khi chưa có bảng giá API xác minh.</div>
  <div class="divider"></div><div class="panel-head"><h2>03. Nhập kết quả về app</h2>${icon('upload')}</div>
  <p class="tiny muted">Tải video hoàn tất từ Fish, rồi chọn file bên dưới. App lưu và phát video trên thiết bị này.</p>
  <div class="field"><label for="lip-result-project">Gắn với gói tư liệu</label><select id="lip-result-project"></select></div>
  <div class="field"><label for="lip-result-upload">Video kết quả đã tải từ Fish</label><input id="lip-result-upload" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v"><small>80 MB / 3 phút. Không tự truy xuất lịch sử Fish.</small></div>
  <button id="import-lip-result" class="full">${icon('upload')} Nhập video kết quả</button><p id="lip-result-status" class="status-line" aria-live="polite"></p>
  <div class="divider"></div><h3>Lịch sử cục bộ</h3><p class="tiny muted" id="legacy-jobs-note"></p><div id="jobs"></div></section></div>`;
}
function settingsMarkup() {
  return `<div class="hero"><div><span class="eyebrow">YOUR STUDIO, YOUR CONTROL</span><h1>Kết nối & <span class="hero-accent">kiểm soát.</span></h1><p>API key được cấu hình trên Vercel, không lưu trong trình duyệt.</p></div><button id="refresh-settings" class="small">${icon('refresh')} Kiểm tra cấu hình</button></div><div class="grid2"><section class="panel"><div class="panel-head"><h2>Kết nối nhà cung cấp</h2>${icon('settings')}</div><div id="provider-list" class="provider-grid"></div><div class="divider"></div><p class="tiny muted">Trạng thái này chỉ xác nhận đã cài biến môi trường, không xác nhận key còn hiệu lực hay còn hạn mức.</p><div class="divider"></div><h3>Cài key ở đâu?</h3><p class="steps-text">Vercel → Project → Settings → Environment Variables.<br>Thêm key cho dịch vụ cần dùng, chọn đúng môi trường, sau đó <strong>Redeploy</strong>.<br>Không đưa <code>.env.local</code> lên GitHub.</p><div class="divider"></div><div class="row"><a href="https://fish.audio/app/api-keys" target="_blank" rel="noopener noreferrer">Fish keys</a><span class="muted">·</span><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google keys</a><span class="muted">·</span><a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">DeepSeek</a><span class="muted">·</span><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI</a></div></section><section class="panel"><div class="panel-head"><h2>Dữ liệu & an toàn</h2>${icon('shield')}</div><div id="limiter-notice" class="notice"></div><table class="settings-table"><tbody><tr><td>Video, giọng mẫu</td><td>Lưu bằng IndexedDB trên thiết bị này; chưa đồng bộ cloud. Nên tải bản sao file quan trọng.</td></tr><tr><td>Phân tích tiết kiệm</td><td>Gửi các ảnh lấy mẫu, không có âm thanh; có thể bỏ sót cảnh ngắn.</td></tr><tr><td>Video đầy đủ</td><td>Gửi qua Google Files. App thử xóa file sau lượt phân tích; việc lưu dữ liệu khác theo chính sách Google.</td></tr><tr><td>Clone tức thời</td><td>Gửi mẫu WAV + bản chép lời cùng mỗi lần TTS; không tạo Voice ID lưu trên Fish.</td></tr><tr><td>Media lip-sync</td><td>Chuẩn bị cục bộ, tự tải lên Fish Creative. Chưa có API Lip Sync trong bản này; không gửi media tự động.</td></tr><tr><td>Hạn mức</td><td>Tính theo lượt thử/UTC ngày, không phải trần chi tiêu USD. Cài hạn mức tại nhà cung cấp.</td></tr></tbody></table><div class="divider"></div><div class="notice warning">Chỉ clone người cho phép. Không dùng để mạo danh lừa đảo. Nên công bố nội dung đã được tạo/chỉnh sửa bằng AI khi phù hợp.</div><div class="divider"></div><button id="clear-local" class="danger small">${icon('trash')} Xóa thư viện cục bộ</button><p class="tiny muted status-line">Xóa cục bộ không hủy job hay xóa bản lưu ở nhà cung cấp. Không dùng chung trình duyệt cho dữ liệu nhạy cảm.</p></section></div>`;
}
function renderApp() {
  $('#login-screen').hidden = true; $('#app').hidden = false;
  $('#app').innerHTML = `<aside class="sidebar"><div class="brand">${logo}<div><strong>cliplab<span class="hero-accent">.</span></strong><small>AI CREATOR STUDIO</small></div></div><div class="workspace"><span class="avatar">C</span><div><strong>Creator workspace</strong><p class="tiny muted">Studio của bạn</p></div></div><p class="nav-label">KHÔNG GIAN SÁNG TẠO</p><nav class="nav" aria-label="Chức năng">${Object.entries(pages).map(([p, label], i) => `<button data-page="${p}" class="${p === 'media' ? 'active' : ''}">${icon(['video','pen','mic','magic','settings'][i])}<span>${label}</span><span class="nav-num">0${i + 1}</span></button>`).join('')}</nav><div class="sidebar-bottom"><div class="free-card"><span class="pill green"><span class="dot"></span> FISH FREE MODE</span><h3>Giọng riêng. Chi phí nhẹ.</h3><p>App chỉ gọi s2.1-pro-free.<br>Không tự chuyển model trả phí.</p></div><p class="footnote">ClipLab v1.1 · Built for creators<br>Fair Use & hạn mức API vẫn áp dụng.</p></div></aside><main class="main"><header class="topbar"><div class="crumb"><span>Workspace</span><span>/</span><strong id="breadcrumb">Tư liệu video</strong></div><div class="user-badge"><span class="pill green"><span class="dot"></span> Studio riêng</span><div class="avatar">${esc(S.session.username.slice(0, 2).toUpperCase())}</div><strong>${esc(S.session.username)}</strong><button id="logout" class="small subtle" aria-label="Đăng xuất">${icon('logout')}</button></div></header><div class="content"><div id="page-media">${mediaMarkup()}</div><div id="page-script" hidden>${scriptMarkup()}</div><div id="page-voice" hidden>${voiceMarkup()}</div><div id="page-lip" hidden>${lipMarkup()}</div><div id="page-settings" hidden>${settingsMarkup()}</div><footer class="privacy-footer">ClipLab không tự gửi tư liệu khi bạn chỉ quay hoặc tải file vào thư viện. AI có thể sai; kiểm tra kết quả và quyền sử dụng trước khi xuất bản.</footer></div></main>`;
}
function navigate(page) {
  if (!pages[page]) return;
  if (S.camera.recording || S.mic.recording) return toast('Hãy dừng quay/thu trước khi chuyển mục.', true);
  if (page !== 'media' && S.camera.stream) closeCamera();
  S.page = page;
  for (const p of Object.keys(pages)) $(`#page-${p}`).hidden = page !== p;
  $$('.nav [data-page]').forEach(b => { b.classList.toggle('active', b.dataset.page === page); b.setAttribute('aria-current', b.dataset.page === page ? 'page' : 'false'); });
  $('#breadcrumb').textContent = pages[page]; window.scrollTo({ top: 0 });
  if (page === 'lip') updateLipSources();
}
function videoAsset() { return S.assets.find(a => a.id === S.selectedVideo && a.kind === 'video'); }
function status(target, value) { $(target).textContent = value; }
function requireConsent(selector) { if (!$(selector).checked) throw new Error('Hãy đọc và xác nhận quyền sử dụng / chia sẻ dữ liệu.'); }
function ensureProvider(name) { if (!S.session.providers[name]) throw new Error('Chưa cài API key. Mở Thiết lập để xem hướng dẫn.'); }
function updateCounts() {
  const script = $('#script-editor').value; const voice = $('#voice-text').value;
  $('#script-count').textContent = `${script.length.toLocaleString('vi-VN')} ký tự`;
  $('#voice-count').textContent = `${voice.length.toLocaleString('vi-VN')} / 3.000 ký tự · ${new TextEncoder().encode(voice).length.toLocaleString('vi-VN')} byte UTF-8`;
}
function showAnalysis(result) {
  $('#analysis-result').hidden = !result;
  if (!result) return;
  $('#analysis-summary').textContent = result.summary;
  const warnings = Array.isArray(result.warnings) ? result.warnings.filter(x => typeof x === 'string') : [];
  const baseWarning = result.mode === 'frames' ? 'Chỉ phân tích khung hình lấy mẫu, không nghe âm thanh. Có thể bỏ sót cảnh nhanh.' : 'Kết quả do AI suy ra từ video; hãy kiểm tra lại.';
  $('#analysis-warnings').textContent = [baseWarning, ...warnings].join(' ');
  $('#analysis-scenes').innerHTML = result.scenes.map(s => `<div class="scene"><time>${esc(s.time)}</time><div><p>${esc(s.visual)}</p><p class="suggestion">Gợi ý dựng: ${esc(s.suggestion)}</p></div></div>`).join('');
  $('#analysis-script').value = result.script;
  $('#analysis-usage').textContent = `${result.model} · Input: ${result.usage?.promptTokenCount ?? '?'} tokens · Output: ${result.usage?.candidatesTokenCount ?? '?'} tokens. Hóa đơn phụ thuộc tài khoản Google.`;
}
function selectVideo(id) {
  if (S.camera.recording) return toast('Dừng quay trước khi đổi tư liệu.', true);
  closeCamera(); S.selectedVideo = id;
  const record = videoAsset(); const player = $('#camera-video');
  if (record) {
    player.srcObject = null; player.src = blobUrl(record); player.controls = true; player.muted = false;
    $('#camera-empty').hidden = true;
    $('#analysis-source').textContent = `${record.name} · ${clock(record.duration)} · ${size(record.blob.size)}`;
    $('#lip-video').value = record.id;
  } else {
    player.removeAttribute('src'); player.load(); player.controls = false;
    $('#camera-empty').hidden = false; $('#analysis-source').textContent = 'Chưa chọn video.';
  }
  showAnalysis(record?.analysis); renderVideoLibrary(); updateLipSources();
}
async function ingestVideo(file, hint = 0) {
  if (file.size > 80 * 1024 * 1024) throw new Error('Video vượt 80 MB. Nén hoặc cắt ngắn trước khi thêm.');
  const mime = cleanMime(file);
  if (!['video/mp4','video/webm','video/quicktime','video/x-m4v'].includes(mime)) throw new Error('Chỉ hỗ trợ MP4, WebM, MOV.');
  const duration = await durationOf(file, 'video', hint);
  if (duration > 180 || duration < 0.1) throw new Error('Video cần dài từ 0,1 đến 180 giây.');
  const record = { id: crypto.randomUUID(), name: file.name || `Video ${new Date().toLocaleString('vi-VN')}`, blob: new Blob([file], { type: mime }), kind: 'video', duration, createdAt: Date.now() };
  try { await put('assets', record); } catch (e) { download(record.blob, assetFilename(record)); throw e; }
  S.assets = await all('assets'); renderSources(); selectVideo(record.id);
  status('#camera-status', `Đã lưu cục bộ: ${clock(duration)} · ${size(file.size)}. Chưa gửi sang AI.`);
}
function renderVideoLibrary() {
  const videos = S.assets.filter(a => a.kind === 'video'); $('#video-count').textContent = videos.length;
  $('#video-library').innerHTML = videos.length ? videos.map(v => `<article class="asset-card ${v.id === S.selectedVideo ? 'selected' : ''}"><div class="asset-thumb"><video src="${esc(blobUrl(v))}" preload="metadata" muted playsinline></video><span class="duration">${clock(v.duration)}</span></div><div class="asset-body"><div class="asset-title" title="${esc(v.name)}">${esc(v.name)}</div><p class="asset-meta">${size(v.blob.size)} · ${new Date(v.createdAt).toLocaleDateString('vi-VN')} ${v.analysis ? '· Đã phân tích' : ''}</p><div class="asset-actions"><button class="small ${v.id === S.selectedVideo ? 'primary' : ''}" data-select-video="${v.id}">${v.id === S.selectedVideo ? 'Đang chọn' : 'Chọn'}</button><button class="small" data-save-asset="${v.id}" aria-label="Tải video">${icon('down')}</button><button class="small subtle danger" data-delete-asset="${v.id}" aria-label="Xóa video">${icon('trash')}</button></div></div></article>`).join('') : '<div class="empty">Chưa có tư liệu.<br>Quay video đầu tiên hoặc tải file của bạn.</div>';
}
function renderVoices() {
  const selected = $('#voice-select').value || S.selectedVoice;
  $('#voice-select').innerHTML = '<option value="">Giọng mặc định Fish</option>' + S.voices.map(v => `<option value="${v.id}">${esc(v.name)} · ${clock(v.duration)}</option>`).join('');
  if (S.voices.some(v => v.id === selected)) $('#voice-select').value = selected;
  $('#voice-library').innerHTML = S.voices.length ? S.voices.map(v => `<div class="voice-card ${v.id === selected ? 'active' : ''}"><div class="row between"><div class="row">${icon('mic')}<strong>${esc(v.name)}</strong></div><span class="pill">${clock(v.duration)}</span></div><audio src="${esc(blobUrl(v))}" controls preload="none"></audio><div class="row"><button class="small" data-use-voice="${v.id}">Dùng giọng</button><button class="small" data-save-voice="${v.id}">${icon('down')} WAV</button><button class="small subtle danger" data-delete-voice="${v.id}" aria-label="Xóa mẫu giọng">${icon('trash')}</button></div></div>`).join('') : '<div class="empty">Mẫu clone của bạn sẽ xuất hiện ở đây.</div>';
}
function renderSources() {
  for (const [selector, kinds] of [['#lip-video',['image','video']],['#lip-audio',['audio']]]) {
    const previous = $(selector).value;
    const records = S.assets.filter(a => kinds.includes(a.kind));
    $(selector).innerHTML = `<option value="">Chọn ${selector === '#lip-video' ? 'ảnh/video' : 'audio'}...</option>` + records.map(a => `<option value="${a.id}">${esc(a.name)} · ${a.kind === 'image' ? 'Ảnh' : clock(a.duration)}</option>`).join('');
    if (records.some(a => a.id === previous)) $(selector).value = previous;
    else if (selector === '#lip-video' && S.selectedVideo) $(selector).value = S.selectedVideo;
  }
  renderVideoLibrary(); updateLipSources();
}
function updateLipSources() {
  const visual = S.assets.find(a => a.id === $('#lip-video').value), audio = S.assets.find(a => a.id === $('#lip-audio').value);
  for (const [el, record] of [[$('#lip-source-preview'),visual?.kind === 'video' ? visual : null],[$('#lip-audio-preview'),audio]]) {
    el.hidden = !record;
    if (record && el.src !== blobUrl(record)) { el.src = blobUrl(record); el.preload = 'metadata'; }
    else if (!record) { el.removeAttribute('src'); el.load(); }
  }
  const image = $('#lip-image-preview'); image.hidden = visual?.kind !== 'image';
  if (!image.hidden) image.src = blobUrl(visual); else image.removeAttribute('src');
  $('#lip-download-visual').disabled = !visual; $('#lip-download-audio').disabled = !audio;
  $('#lip-source-info').textContent = visual && audio ? `${visual.kind === 'image' ? 'Ảnh nhân vật' : 'Video ' + clock(visual.duration)} + audio ${clock(audio.duration)}. File chưa được gửi sang Fish.${visual.blob.type === 'video/webm' ? ' Nguồn là WebM; nếu Fish không nhận, cần chuyển mã sang MP4 trước.' : ''}` : 'Chọn ảnh/video và audio để chuẩn bị gói tư liệu.';
}
function renderSettings() {
  const cfg = S.session;
  $('#google-model-label').textContent = `${cfg.models.google} · Model chi phí thấp, có free tier theo hạn mức Google.`;
  $('#fish-notice').textContent = `Fish công bố S2.1 Pro Free đến ${cfg.fishFreeUntil}. App không tự chuyển sang model trả phí và sẽ chặn TTS sau mốc này. Fair Use, giới hạn truy cập và điều kiện thương mại của Fish vẫn áp dụng; không có cam kết SLA.`;
  const defs = [['fish','Fish Audio','FISH_API_KEY'],['google','Google Gemini','GOOGLE_API_KEY'],['deepseek','DeepSeek','DEEPSEEK_API_KEY'],['openai','OpenAI','OPENAI_API_KEY']];
  $('#provider-list').innerHTML = defs.map(([id, name, env]) => `<div class="provider"><h3>${name}</h3><span class="pill ${cfg.providers[id] ? 'green' : ''}"><span class="dot"></span>${cfg.providers[id] ? 'Đã cài biến key' : 'Chưa cài key'}</span><code>${env}</code></div>`).join('') + `<div class="provider"><h3>Fish Creative Lip Sync</h3><span class="pill purple">Mở web Fish</span><small>Không dùng API key lip-sync. Chưa tích hợp API tạo video.</small></div>`;
  $('#limiter-notice').textContent = cfg.limiter === 'redis' ? 'Đang dùng Redis: hạn mức tác vụ AI được chia sẻ giữa các server.' : 'Chưa cài Redis: hạn mức chỉ là bộ nhớ tạm trên từng server. Chỉ dùng cho 1 người thử nghiệm. App sẽ chặn tác vụ nhiều thành viên khi chưa có Redis.';
  $('#limiter-notice').className = `notice ${cfg.limiter === 'redis' ? 'success' : 'warning'}`;
  updateTextProvider();
}
function updateTextProvider() { const p = $('#text-provider').value; $('#text-model-label').textContent = `${S.session.models[p]} · ${S.session.providers[p] ? 'đã cài key' : 'chưa cài key'}`; }
function closeCamera() {
  S.camera.close();
  if (!$('#camera-video')) return;
  $('#camera-video').srcObject = null; $('#open-camera').disabled = false; $('#start-record').disabled = true;
  $('#close-camera').hidden = true; $('#record-time').hidden = true;
  if (!videoAsset()) $('#camera-empty').hidden = false;
}
async function prepareReference(file) {
  const ref = await audioReference(file); S.pendingReference = ref;
  if (S.pendingReferenceUrl) URL.revokeObjectURL(S.pendingReferenceUrl);
  S.pendingReferenceUrl = URL.createObjectURL(ref.blob);
  $('#reference-preview').src = S.pendingReferenceUrl; $('#reference-preview').hidden = false;
  $('#reference-info').textContent = `WAV mono 16 kHz · ${clock(ref.duration)} · ${size(ref.blob.size)}${ref.trimmed ? ' · Đã giữ 45 giây đầu; chép đúng phần này.' : ''}`;
}
function showAudio(record) {
  S.latestAudio = record; $('#audio-output').hidden = false; $('#tts-preview').src = blobUrl(record); $('#audio-duration').textContent = clock(record.duration);
  $('#lip-audio').value = record.id; updateLipSources();
}
async function runAnalysis() {
  ensureProvider('google'); requireConsent('#analysis-consent');
  const video = videoAsset(); if (!video) throw new Error('Chọn video tư liệu trước.');
  if (S.camera.recording) throw new Error('Dừng quay trước khi phân tích.');
  const mode = $('input[name="analysis-mode"]:checked').value;
  const payload = { mode, duration: video.duration, brief: $('#analysis-brief').value, consent: true };
  let fileToken;
  $('#analysis-progress').hidden = false;
  const progress = (value, msg) => { $('#analysis-progress>div').style.width = `${value}%`; status('#analysis-status', msg); };
  try {
    if (mode === 'frames') {
      payload.frames = await sampleFrames(video.blob, video.duration, Number($('#frame-count').value), (n, max) => progress(n / max * 45, `Đang lấy khung hình ${n}/${max}...`));
      progress(60, 'Đang gửi khung hình sang Google...');
    } else {
      progress(2, 'Khởi tạo upload Google...');
      const init = await api('google-start', { size: video.blob.size, duration: video.duration, mime: video.blob.type, consent: true }); let ticket = init.ticket;
      for (let offset = 0; offset < video.blob.size; offset += init.chunkSize) {
        const chunk = video.blob.slice(offset, offset + init.chunkSize);
        const result = await api('google-chunk', null, { body: chunk, headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Ticket': ticket } });
        if (result.ticket) ticket = result.ticket;
        if (result.fileToken) fileToken = result.fileToken;
        progress(Math.min(60, (offset + chunk.size) / video.blob.size * 60), `Đang tải video: ${Math.round((offset + chunk.size) / video.blob.size * 100)}%`);
      }
      if (!fileToken) throw new Error('Upload không trả file token.');
      let active = false;
      for (let i = 0; i < 60; i++) {
        const f = await api('google-file', { fileToken });
        if (f.state === 'ACTIVE') { active = true; break; }
        if (f.state === 'FAILED') throw new Error('Google không xử lý được codec video. Thử MP4 H.264.');
        progress(65, 'Google đang chuẩn bị video...'); await pause(2000);
      }
      if (!active) throw new Error('Google chưa chuẩn bị xong video. Thử video ngắn hơn hoặc chế độ khung hình.');
      payload.fileToken = fileToken;
    }
    progress(75, 'AI đang phân tích cảnh và viết kịch bản...');
    const result = await api('analysis', payload); video.analysis = result; await put('assets', video);
    if (video.id === S.selectedVideo) showAnalysis(result);
    renderVideoLibrary(); progress(100, 'Đã phân tích và lưu vào tư liệu.'); toast('Kết quả phân tích đã sẵn sàng.');
  } finally {
    $('#analysis-progress').hidden = true;
    if (fileToken) { try { await api('google-delete', { fileToken }); } catch { toast('Chưa xóa được file tạm Google. Việc hết hạn theo Google Files.', true); } }
  }
}
function visibleJobs() { return S.jobs.filter(j => j.provider === HANDOFF_PROVIDER); }
function renderJobs() {
  const jobs = visibleJobs();
  const previous = $('#lip-result-project').value || S.activeHandoff;
  $('#lip-result-project').innerHTML = '<option value="">Lưu thành kết quả mới</option>' + jobs.map(j => `<option value="${j.id}">${esc(j.name)} · ${new Date(j.createdAt).toLocaleString('vi-VN')}</option>`).join('');
  if (jobs.some(j => j.id === previous)) $('#lip-result-project').value = previous;
  const legacy = S.jobs.length - jobs.length;
  $('#legacy-jobs-note').textContent = legacy ? `${legacy} bản ghi tích hợp cũ vẫn giữ trong bộ nhớ. Bản này không gọi hay tải media từ dịch vụ cũ.` : 'Trạng thái dưới đây là thao tác trong ClipLab, không phải tiến độ xử lý trên Fish.';
  $('#jobs').innerHTML = jobs.length ? jobs.map(j => {
    const result = S.assets.find(a => a.id === j.resultAssetId && a.kind === 'video');
    const label = result ? 'Đã nhập video' : j.status === 'RESULT_IMPORTED' ? 'File kết quả đã xóa' : j.openedAt ? 'Đã mở trang Fish' : 'Đã xuất tư liệu';
    return `<article class="job"><div class="row between"><strong>${esc(j.name || 'Dự án Fish Creative')}</strong><span class="pill ${result ? 'green' : 'purple'}">${label}</span></div><p class="tiny muted">${new Date(j.createdAt).toLocaleString('vi-VN')} · Lưu cục bộ</p>${result ? `<video class="lip-preview" src="${esc(blobUrl(result))}" controls playsinline preload="metadata"></video><button class="small primary" data-save-asset="${result.id}">${icon('down')} Tải video</button>` : '<p class="tiny muted">Tạo video trên Fish, sau đó nhập file kết quả về đây.</p>'}<div class="row lip-download-row"><button class="small" data-result-project="${j.id}">Chọn để nhập kết quả</button><button class="small subtle danger" data-forget-job="${j.id}">Xóa bản ghi</button></div></article>`;
  }).join('') : '<div class="empty">Chưa có gói tư liệu hay video nhập về.<br>Chọn hình và giọng để bắt đầu.</div>';
}
async function exportFishBundle() {
  requireConsent('#lip-consent');
  const visual = S.assets.find(a => a.id === $('#lip-video').value), audio = S.assets.find(a => a.id === $('#lip-audio').value);
  validateHandoff(visual, audio);
  const id = crypto.randomUUID();
  status('#lip-status', 'Đang đóng gói trên thiết bị, không upload...');
  const { blob } = await buildHandoffBundle({ visual, audio, id, script: $('#voice-text').value.trim() || $('#script-editor').value,
    progress: (done, total) => status('#lip-status', `Đang đóng gói cục bộ: ${done}/${total} file...`) });
  const job = { id, provider: HANDOFF_PROVIDER, name: visual.name, visualId: visual.id, audioId: audio.id, createdAt: Date.now(), status: 'PREPARED' };
  // Persist before downloading so the exported files have a matching local project.
  await put('jobs', job); S.jobs.unshift(job); S.activeHandoff = id; renderJobs(); $('#lip-result-project').value = id;
  download(blob, `ClipLab-Fish-${id.slice(0, 8)}.zip`);
  status('#lip-status', 'Đã chuẩn bị ZIP. Giải nén, mở Fish Creative và tải các file lên. Chưa gửi job hay trừ credit.');
}
async function addLipVisual(file) {
  const mime = cleanMime(file);
  if (mime.startsWith('video/')) {
    await ingestVideo(file); $('#lip-video').value = S.selectedVideo; updateLipSources(); return;
  }
  if (!['image/jpeg','image/png','image/webp'].includes(mime) || !file.size || file.size > 20 * 1024 * 1024) throw new Error('Cần ảnh JPG, PNG hoặc WebP dưới 20 MB.');
  const blob = new Blob([file], { type: mime }), bitmap = await createImageBitmap(blob);
  const width = bitmap.width, height = bitmap.height; bitmap.close();
  if (!width || !height || width * height > 40000000) throw new Error('Ảnh quá lớn; giảm xuống dưới 40 megapixel.');
  const record = { id: crypto.randomUUID(), name: file.name, blob, kind: 'image', width, height, createdAt: Date.now() };
  await put('assets', record); S.assets = await all('assets'); renderSources(); $('#lip-video').value = record.id; updateLipSources();
  status('#lip-status', 'Đã thêm ảnh cục bộ. Chưa gửi sang Fish.');
}
async function importFishResult() {
  const file = $('#lip-result-upload').files[0];
  if (!file) throw new Error('Chọn video đã tải từ Fish trước.');
  const mime = cleanMime(file);
  if (!['video/mp4','video/webm','video/quicktime','video/x-m4v'].includes(mime) || !file.size || file.size > 80 * 1024 * 1024) throw new Error('Video kết quả cần MP4/WebM/MOV dưới 80 MB.');
  const duration = await durationOf(file, 'video');
  if (duration < 0.1 || duration > 180) throw new Error('Video kết quả cần dài 0,1-180 giây.');
  let job = visibleJobs().find(j => j.id === $('#lip-result-project').value);
  if (job?.resultAssetId && !confirm('Thay liên kết kết quả cho gói này? Video cũ vẫn giữ trong thư viện.')) return;
  const record = { id: crypto.randomUUID(), name: file.name, kind: 'video', blob: new Blob([file], { type: mime }), duration, createdAt: Date.now(), source: 'user-imported-fish-result' };
  await put('assets', record);
  const isNew = !job;
  if (!job) job = { id: crypto.randomUUID(), provider: HANDOFF_PROVIDER, name: file.name, createdAt: Date.now() };
  job.resultAssetId = record.id; job.status = 'RESULT_IMPORTED'; job.importedAt = Date.now();
  await put('jobs', job); if (isNew) S.jobs.unshift(job);
  S.assets = await all('assets'); S.activeHandoff = job.id; renderSources(); renderJobs(); $('#lip-result-project').value = job.id;
  $('#lip-result-upload').value = ''; status('#lip-result-status', 'Đã nhập video vào thư viện cục bộ. Hãy xem lại khớp miệng và âm thanh trước khi xuất bản.');
  toast('Đã nhập video kết quả.');
}

function assetFilename(record) {
  if (/\.[a-z0-9]{2,5}$/i.test(record.name)) return record.name;
  const ext = { 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/mp4': 'mp4', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[record.blob.type] || 'bin';
  return `${record.name}.${ext}`;
}
function bindEvents() {
  $('#app').addEventListener('click', e => {
    const button = e.target.closest('button'); if (!button) return;
    if (button.dataset.page) return navigate(button.dataset.page);
    if (button.dataset.selectVideo) return selectVideo(button.dataset.selectVideo);
    if (button.dataset.saveAsset) { const a = S.assets.find(a => a.id === button.dataset.saveAsset); if (a) download(a.blob, assetFilename(a)); }
    if (button.dataset.deleteAsset) busy(button, async () => {
      if (S.progress.size > 1 || S.camera.recording) throw new Error('Hoàn thành tác vụ hiện tại trước khi xóa.');
      if (!confirm('Xóa file khỏi thư viện cục bộ? Bản đã gửi cho nhà cung cấp không bị xóa bởi thao tác này.')) return;
      await remove('assets', button.dataset.deleteAsset); S.assets = await all('assets');
      if (!S.assets.some(a => a.id === S.selectedVideo)) S.selectedVideo = S.assets.find(a => a.kind === 'video')?.id || null;
      renderSources(); selectVideo(S.selectedVideo); renderJobs();
    });
    if (button.dataset.useVoice) { S.selectedVoice = button.dataset.useVoice; $('#voice-select').value = S.selectedVoice; renderVoices(); navigate('voice'); toast('Đã chọn mẫu giọng.'); }
    if (button.dataset.saveVoice) { const v = S.voices.find(v => v.id === button.dataset.saveVoice); if (v) download(v.blob, `${v.name}.wav`); }
    if (button.dataset.deleteVoice) busy(button, async () => {
      if (!confirm('Xóa mẫu giọng cục bộ này?')) return;
      await remove('voices', button.dataset.deleteVoice); S.voices = await all('voices');
      if (S.selectedVoice === button.dataset.deleteVoice) { S.selectedVoice = ''; $('#voice-select').value = ''; }
      renderVoices();
    });
    if (button.dataset.resultProject) { $('#lip-result-project').value = button.dataset.resultProject; S.activeHandoff = button.dataset.resultProject; $('#lip-result-upload').focus(); }
    if (button.dataset.forgetJob) busy(button, async () => {
      if (!confirm('Chỉ xóa bản ghi cục bộ. Không xóa video trong thư viện hay tác vụ trên Fish. Tiếp tục?')) return;
      await remove('jobs', button.dataset.forgetJob); S.jobs = await all('jobs');
      if (S.activeHandoff === button.dataset.forgetJob) S.activeHandoff = null;
      renderJobs();
    });
  });
  $('#open-camera').onclick = () => busy($('#open-camera'), async () => {
    if (S.camera.recording) throw new Error('Camera đang quay.');
    const stream = await S.camera.open({ facing: $('#camera-facing').value, portrait: $('#camera-ratio').value === 'portrait', audio: $('#camera-audio').checked });
    const player = $('#camera-video'); player.removeAttribute('src'); player.srcObject = stream; player.controls = false; player.muted = true; await player.play();
    $('#camera-empty').hidden = true; $('#start-record').disabled = false; $('#close-camera').hidden = false;
    status('#camera-status', 'Camera sẵn sàng. Bấm Quay để bắt đầu.');
  }, '#camera-status');
  $('#start-record').onclick = () => busy($('#start-record'), async () => {
    $('#stop-record').hidden = false; $('#open-camera').disabled = true; $('#close-camera').hidden = true; $('#record-time').hidden = false;
    try {
      const result = await S.camera.start(179, t => { $('#record-time').textContent = `REC ${clock(t)}`; });
      S.camera.close(); $('#camera-video').srcObject = null;
      const ext = result.blob.type.includes('mp4') ? 'mp4' : 'webm';
      await ingestVideo(new File([result.blob], `tu-lieu-${Date.now()}.${ext}`, { type: result.blob.type }), result.duration);
    } finally {
      $('#stop-record').hidden = true; closeCamera();
      // busy() restores the button; leave it disabled until camera is opened again.
      setTimeout(() => { $('#start-record').disabled = !S.camera.stream; }, 0);
    }
  }, '#camera-status');
  $('#stop-record').onclick = () => S.camera.stop();
  $('#close-camera').onclick = () => { closeCamera(); selectVideo(S.selectedVideo); };
  $('#choose-video').onclick = () => { if (S.camera.recording) return toast('Dừng quay trước.', true); $('#video-file').click(); };
  $('#video-file').onchange = e => { const file = e.target.files[0]; if (file) busy($('#choose-video'), () => ingestVideo(file), '#camera-status'); e.target.value = ''; };
  const drop = $('#video-drop');
  for (const name of ['dragenter','dragover']) drop.addEventListener(name, e => { e.preventDefault(); drop.classList.add('drag'); });
  for (const name of ['dragleave','drop']) drop.addEventListener(name, e => { e.preventDefault(); drop.classList.remove('drag'); });
  drop.addEventListener('drop', e => { const file = e.dataTransfer.files[0]; if (file && !S.camera.recording) busy($('#choose-video'), () => ingestVideo(file), '#camera-status'); });
  $$('input[name="analysis-mode"]').forEach(el => el.onchange = () => { $('#frame-field').hidden = el.value !== 'frames'; });
  $('#analyze-btn').onclick = () => busy($('#analyze-btn'), runAnalysis, '#analysis-status');
  $('#analysis-to-script').onclick = () => { $('#script-editor').value = $('#analysis-script').value; saveDraft(); updateCounts(); navigate('script'); };
  $('#text-provider').onchange = updateTextProvider;
  $('#generate-script').onclick = () => busy($('#generate-script'), async () => {
    const provider = $('#text-provider').value; ensureProvider(provider);
    const result = await api('text', { provider, prompt: $('#script-prompt').value, duration: Number($('#script-duration').value), style: $('#script-style').value, context: $('#include-analysis').checked && videoAsset()?.analysis ? JSON.stringify(videoAsset().analysis) : '' });
    $('#script-editor').value = result.text; saveDraft(); updateCounts(); status('#script-status', `Đã tạo bằng ${result.model}. Hãy đọc và kiểm tra lại nội dung.`);
  }, '#script-status');
  for (const el of ['#script-editor','#script-prompt','#voice-text','#analysis-brief']) $(el).addEventListener('input', () => { saveDraft(); updateCounts(); });
  $('#export-script').onclick = () => { if (!$('#script-editor').value.trim()) return toast('Chưa có kịch bản.', true); download(new Blob([$('#script-editor').value], { type: 'text/plain;charset=utf-8' }), 'kich-ban.txt'); };
  $('#script-to-voice').onclick = () => {
    const text = $('#script-editor').value;
    if (!text.trim() || text.length > 3000) return toast('Kịch bản cần 1-3.000 ký tự. Chia đoạn dài trước khi tạo giọng.', true);
    $('#voice-text').value = text; saveDraft(); updateCounts(); navigate('voice');
  };
  $('#reference-file').onchange = e => { const file = e.target.files[0]; if (file) busy($('#save-voice'), () => prepareReference(file)); e.target.value = ''; };
  $('#mic-record').onclick = () => busy($('#mic-record'), async () => {
    try {
      await S.mic.open({ video: false, audio: true }); $('#mic-stop').hidden = false; $('#mic-time').hidden = false;
      const result = await S.mic.start(44.8, t => { $('#mic-time').textContent = clock(t); });
      S.mic.close(); await prepareReference(result.blob);
    } finally { S.mic.close(); $('#mic-stop').hidden = true; $('#mic-time').hidden = true; }
  });
  $('#mic-stop').onclick = () => S.mic.stop();
  $('#save-voice').onclick = () => busy($('#save-voice'), async () => {
    requireConsent('#clone-consent'); if (!S.pendingReference) throw new Error('Tải mẫu giọng hoặc thu micro trước.');
    const transcript = $('#reference-transcript').value.trim(); if (!transcript) throw new Error('Chép đúng câu nói trong mẫu giọng.');
    const voice = { id: crypto.randomUUID(), name: $('#voice-name').value.trim() || `Giọng ${S.voices.length + 1}`, transcript, blob: S.pendingReference.blob, duration: S.pendingReference.duration, createdAt: Date.now() };
    await put('voices', voice); S.voices = await all('voices'); S.selectedVoice = voice.id; $('#voice-select').value = ''; renderVoices();
    toast('Đã lưu mẫu trên thiết bị. Fish chỉ nhận mẫu khi bạn bấm tạo giọng.');
  });
  $('#voice-select').onchange = () => { S.selectedVoice = $('#voice-select').value; renderVoices(); };
  $('#generate-voice').onclick = () => busy($('#generate-voice'), async () => {
    ensureProvider('fish'); requireConsent('#tts-consent');
    const voice = S.voices.find(v => v.id === $('#voice-select').value);
    const payload = { text: $('#voice-text').value, speed: Number($('#voice-speed').value), consent: true };
    if (voice) { payload.reference = await toBase64(voice.blob); payload.transcript = voice.transcript; }
    const blob = await api('tts', payload);
    const duration = await durationOf(blob, 'audio');
    const record = { id: crypto.randomUUID(), name: `loi-doc-${Date.now()}.mp3`, kind: 'audio', blob, duration, source: 'fish', createdAt: Date.now() };
    try { await put('assets', record); } catch (e) { download(blob, record.name); throw e; }
    S.assets = await all('assets'); renderSources(); showAudio(record);
    status('#voice-status', `Đã tạo MP3 ${clock(duration)} bằng s2.1-pro-free.${duration > 180 ? ' Audio vượt 3 phút: rút kịch bản trước khi lip-sync.' : ''}`);
  }, '#voice-status');
  $('#download-audio').onclick = () => { if (S.latestAudio) download(S.latestAudio.blob, assetFilename(S.latestAudio)); };
  $('#voice-to-lip').onclick = () => { if (S.latestAudio) $('#lip-audio').value = S.latestAudio.id; navigate('lip'); };
  $('#lip-video').onchange = $('#lip-audio').onchange = updateLipSources;
  $('#lip-visual-upload').onchange = e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    busy($('#generate-lip'), () => addLipVisual(file), '#lip-status');
  };
  $('#lip-audio-upload').onchange = e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    busy($('#generate-lip'), async () => {
      const mime = cleanMime(file);
      if (!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/aac'].includes(mime) || !file.size || file.size > 80 * 1024 * 1024) throw new Error('Cần MP3, WAV, OGG, M4A hoặc AAC dưới 80 MB.');
      const duration = await durationOf(file, 'audio'); if (duration > 180 || duration < 0.1) throw new Error('Audio cần dài 0,1-180 giây.');
      const record = { id: crypto.randomUUID(), name: file.name, kind: 'audio', blob: new Blob([file], { type: mime }), duration, createdAt: Date.now() };
      await put('assets', record); S.assets = await all('assets'); renderSources(); $('#lip-audio').value = record.id; updateLipSources();
    }, '#lip-status');
  };
  $('#generate-lip').onclick = () => busy($('#generate-lip'), exportFishBundle, '#lip-status');
  for (const [buttonId, selector, prefix] of [['#lip-download-visual','#lip-video','01-source'],['#lip-download-audio','#lip-audio','02-voice']]) {
    $(buttonId).onclick = () => busy($(buttonId), async () => {
      requireConsent('#lip-consent'); const record = S.assets.find(a => a.id === $(selector).value);
      if (!record) throw new Error('Chọn file trước.'); download(record.blob, mediaFilename(record, prefix));
    }, '#lip-status');
  }
  $('#open-fish-creative').addEventListener('click', () => {
    const job = visibleJobs().find(j => j.id === ($('#lip-result-project').value || S.activeHandoff));
    if (job) { job.openedAt = Date.now(); put('jobs', job).then(renderJobs).catch(e => toast(e.message, true)); }
    status('#lip-status', 'Đã yêu cầu mở Fish Creative. File vẫn ở máy; bạn tự tải lên Fish và bấm Generate.');
  });
  $('#lip-result-project').onchange = () => { S.activeHandoff = $('#lip-result-project').value || null; };
  $('#import-lip-result').onclick = () => busy($('#import-lip-result'), importFishResult, '#lip-result-status');
  $('#refresh-settings').onclick = () => busy($('#refresh-settings'), async () => { S.session = await api('session'); renderSettings(); toast('Đã đọc cấu hình máy chủ. Trạng thái key không phải kiểm tra số dư/quyền API.'); });
  $('#clear-local').onclick = () => busy($('#clear-local'), async () => {
    if (S.progress.size > 1 || S.camera.recording || S.mic.recording) throw new Error('Hoàn thành tác vụ đang chạy trước khi xóa.');
    if (!confirm('Xóa TẤT CẢ video, mẫu giọng, bản nháp và lịch sử cục bộ của tài khoản? Không xóa tác vụ trên Fish. Hãy tải file quan trọng trước.')) return;
    await Promise.all(['assets','voices','jobs'].map(clear)); localStorage.removeItem(draftKey()); releaseUrls();
    S.assets = []; S.voices = []; S.jobs = []; S.selectedVideo = null; S.selectedVoice = ''; S.latestAudio = null; S.activeHandoff = null;
    S.pendingReference = null; if (S.pendingReferenceUrl) URL.revokeObjectURL(S.pendingReferenceUrl); S.pendingReferenceUrl = null; $('#reference-preview').removeAttribute('src'); $('#reference-preview').hidden = true; $('#reference-info').textContent = ''; $('#reference-transcript').value = ''; $('#voice-name').value = '';
    for (const id of ['#script-editor','#script-prompt','#voice-text','#analysis-brief']) $(id).value = '';
    $('#audio-output').hidden = true; $('#voice-select').value = ''; renderSources(); renderVoices(); renderJobs(); selectVideo(null); updateCounts(); toast('Đã xóa dữ liệu cục bộ.');
  });
  $('#logout').onclick = () => busy($('#logout'), async () => {
    if (S.progress.size > 1) throw new Error('Hoàn thành tác vụ đang xử lý trước khi đăng xuất.');
    closeCamera(); S.mic.close(); await api('logout', {}); releaseUrls();
    if (S.pendingReferenceUrl) URL.revokeObjectURL(S.pendingReferenceUrl);
    S.session = null; S.pendingReference = null; S.pendingReferenceUrl = null; S.latestAudio = null; $('#app').innerHTML = ''; loginScreen();
  });
}
async function boot() {
  S.session = await api('session'); await initDB(S.session.username);
  [S.assets, S.voices, S.jobs] = await Promise.all(['assets','voices','jobs'].map(all));
  S.activeHandoff = null;
  S.selectedVideo = S.assets.find(a => a.kind === 'video')?.id || null; S.selectedVoice = ''; S.page = 'media';
  renderApp(); bindEvents();
  try { const draft = JSON.parse(localStorage.getItem(draftKey()) || '{}'); $('#script-prompt').value = draft.prompt || ''; $('#script-editor').value = draft.script || ''; $('#voice-text').value = draft.voice || ''; $('#analysis-brief').value = draft.brief || ''; } catch { /* A corrupt local draft must not prevent login. */ }
  if (!S.session.providers.deepseek && S.session.providers.openai) $('#text-provider').value = 'openai';
  renderSources(); renderVoices(); renderJobs(); renderSettings(); selectVideo(S.selectedVideo); updateCounts();
  const latest = S.assets.find(a => a.kind === 'audio'); if (latest) showAudio(latest);
}
loginScreen();
boot().catch(e => { S.session = null; if (e.status !== 401) { loginScreen(); $('#login-error').textContent = e.message; } });
window.addEventListener('beforeunload', e => { if (S.camera.recording || S.mic.recording || S.progress.size) { e.preventDefault(); e.returnValue = ''; } });
