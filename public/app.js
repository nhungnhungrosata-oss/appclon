import { initDB, put, all, remove, clear, blobUrl, releaseUrls, download, pause, cleanMime, durationOf, sampleFrames, toBase64, extractSpeechChunks, composeAlignedSpeech, trimSpeechAudio, replaceVideoAudio, Recorder } from './media.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = n => {
  const p = {
    video:'<rect x="2" y="5" width="14" height="14" rx="3"/><path d="M16 10l6-3v10l-6-3z"/>',
    pen:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4z"/>',
    mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8"/>',
    settings:'<path d="M12 3l2 3 4-1 1 4 3 3-3 2-1 4-4-1-2 3-2-3-4 1-1-4-3-2 3-3 1-4 4 1z"/><circle cx="12" cy="12" r="3"/>',
    upload:'<path d="M12 16V3M7 8l5-5 5 5M3 15v5a1 1 0 001 1h16a1 1 0 001-1v-5"/>',
    down:'<path d="M12 3v13M7 11l5 5 5-5M3 16v4h18v-4"/>',
    play:'<path d="M7 3l14 9-14 9z"/>',
    stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',
    trash:'<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    logout:'<path d="M9 3H3v18h6M9 12h13M17 7l5 5-5 5"/>',
    magic:'<path d="M4 20L17 7M14 4l6 6M5 2v4M3 4h4M19 15v6M16 18h6"/>',
    shield:'<path d="M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z"/><path d="M8 12l3 3 5-6"/>',
    refresh:'<path d="M20 7a9 9 0 10.5 10M20 2v6h-6"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${p[n]||p.magic}</svg>`;
};
const logo='<img class="logo-icon" src="/favicon.svg" alt="">';
const clock=s=>`${String(Math.floor((s||0)/60)).padStart(2,'0')}:${String(Math.floor((s||0)%60)).padStart(2,'0')}`;
const size=b=>(b/1024/1024).toFixed(1)+' MB';
const S={session:null,page:'media',assets:[],selectedVideo:null,camera:new Recorder(),progress:new Set(),latestAudio:null,adminState:null,cloneJob:null};
const pages={media:'Tư liệu video',script:'Viết kịch bản',voice:'Giọng Của Tôi',clone:'Clon giọng Video',settings:'Thiết lập'};
const canOpenPage=page=>page!=='settings'||S.session?.role==='admin';
let toastTimer;

function toast(message,error=false){
  const box=$('#toast'); if(!box)return;
  box.textContent=message; box.classList.toggle('error',error); box.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>box.hidden=true,error?9000:4500);
}
async function api(action,body){
  const init={method:body===undefined?'GET':'POST',credentials:'same-origin',signal:AbortSignal.timeout(65000)};
  if(body!==undefined){init.headers={'Content-Type':'application/json'};init.body=JSON.stringify(body);}
  const r=await fetch(`/api/index?action=${encodeURIComponent(action)}`,init);
  if(!r.ok){let d={};try{d=await r.json()}catch{} const e=new Error(d.error||`HTTP ${r.status}`);e.status=r.status;e.code=d.code;throw e;}
  return r.headers.get('content-type')?.startsWith('audio/')?r.blob():r.json();
}
async function busy(button,fn,statusSel){
  if(!button||S.progress.has(button))return;
  S.progress.add(button);const old=button.innerHTML;button.disabled=true;button.innerHTML='<span class="spinner"></span> Đang xử lý';
  try{await fn()}catch(e){toast(e.message||'Không thể xử lý.',true);if(statusSel&&$(statusSel))$(statusSel).textContent=e.message||'Lỗi';}
  finally{S.progress.delete(button);button.disabled=false;button.innerHTML=old;}
}
function draftKey(){return `cliplab-draft-${S.session.username}`;}
function saveDraft(){
  try{localStorage.setItem(draftKey(),JSON.stringify({prompt:$('#script-prompt')?.value||'',script:$('#script-editor')?.value||'',voice:$('#voice-text')?.value||'',brief:$('#analysis-brief')?.value||''}))}catch{}
}
function loginScreen(){
  $('#app').hidden=true;$('#login-screen').hidden=false;
  $('#login-screen').innerHTML=`<div class="login-wrap"><div class="login-intro"><div class="brand">${logo}<div><strong>cliplab<span class="hero-accent">.</span></strong><small>AI CREATOR STUDIO</small></div></div><span class="eyebrow">IBEE MULTI-USER</span><h1>Tạo nội dung và<br><span class="hero-accent">giọng nói được phân quyền.</span></h1><p>Admin quản lý giọng Ibee cho từng tài khoản; tài khoản con chỉ dùng giọng được cấp.</p><div class="row"><span class="pill green">${icon('shield')} API key ở máy chủ</span><span class="pill purple">Ibee AIVoice</span></div></div><form class="login-card" id="login-form"><h2>Đăng nhập</h2><div class="field"><label>Tên đăng nhập</label><input id="username" autocomplete="username" required maxlength="50"></div><div class="field"><label>Mật khẩu</label><input id="password" type="password" autocomplete="current-password" required maxlength="500"></div><button id="login-btn" class="primary full">Vào studio</button><p id="login-error" class="login-error"></p></form></div>`;
  $('#login-form').onsubmit=e=>{e.preventDefault();busy($('#login-btn'),async()=>{await api('login',{username:$('#username').value,password:$('#password').value});await boot()},'#login-error')};
}
function mediaMarkup(){
 return `<div class="hero"><div><span class="eyebrow">VIDEO MATERIAL</span><h1>Quay hoặc tải <span class="hero-accent">video tư liệu.</span></h1><p>Sau đó dùng Google Gemini để phân tích cảnh và đề xuất lời dẫn.</p></div><span class="pill">${icon('video')} Lưu trên thiết bị</span></div>
 <div class="media-columns"><section class="panel"><div class="panel-head"><h2>Studio ghi hình</h2><span class="pill green">Tối đa 3 phút</span></div>
 <div class="camera-controls"><select id="camera-facing"><option value="user">Camera trước</option><option value="environment">Camera sau</option></select><select id="camera-ratio"><option value="landscape">Ngang 16:9</option><option value="portrait">Dọc 9:16</option></select><label class="check"><input id="camera-audio" type="checkbox" checked> Micro</label></div>
 <div class="camera-box landscape" id="camera-box"><video id="camera-video" playsinline muted></video><div class="camera-empty" id="camera-empty"><span class="camera-symbol">${icon('video')}</span><strong>Quay tư liệu mới</strong><p>Hoặc tải video có sẵn bên dưới.</p></div><span id="record-time" class="rec-badge" hidden>REC 00:00</span></div>
 <div class="row camera-actions"><button id="open-camera" class="primary">${icon('video')} Mở camera</button><button id="start-record" disabled>${icon('play')} Quay</button><button id="stop-record" class="danger" hidden>${icon('stop')} Dừng</button><button id="close-camera" class="small" hidden>Đóng</button></div>
 <div class="dropzone"><div><strong>Tải video từ máy</strong><p>MP4, WebM, MOV · tối đa 80 MB / 3 phút</p></div><button id="choose-video" class="small">${icon('upload')} Chọn file</button><input id="video-file" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" hidden></div><p id="camera-status" class="status-line"></p></section>
 <section class="panel"><div class="panel-head"><h2>Phân tích kịch bản</h2>${icon('magic')}</div><div id="analysis-source" class="source-label">Chưa chọn video.</div>
 <div class="mode-grid"><label class="mode"><input type="radio" name="analysis-mode" value="frames" checked><strong>Tiết kiệm</strong><small>AI xem các khung hình, không nghe audio.</small></label><label class="mode"><input type="radio" name="analysis-mode" value="video"><strong>Video đầy đủ</strong><small>Gửi video qua Google Files.</small></label></div>
 <div id="frame-field" class="field"><label>Số khung</label><select id="frame-count"><option value="12">12</option><option value="24" selected>24</option><option value="48">48</option></select></div>
 <div class="field"><label>Yêu cầu phân tích</label><textarea id="analysis-brief" rows="4" maxlength="6000" placeholder="Ví dụ: phân tích cảnh và viết lời dẫn bán hàng tự nhiên"></textarea></div>
 <label class="check"><input id="analysis-consent" type="checkbox">Tôi có quyền sử dụng video và đồng ý gửi dữ liệu cho Google.</label><button id="analyze-btn" class="purple full">Phân tích kịch bản</button><p id="analysis-status" class="status-line"></p><div class="progress" id="analysis-progress" hidden><div></div></div></section></div>
 <section class="panel result" id="analysis-result" hidden><div class="panel-head"><h2>Kết quả phân tích</h2><button id="analysis-to-script" class="small primary">Đưa sang kịch bản</button></div><div id="analysis-summary" class="result-summary"></div><div id="analysis-scenes" class="scene-list"></div><div class="field"><label>Lời dẫn đề xuất</label><textarea id="analysis-script" rows="7"></textarea></div></section>
 <div class="library-heading"><h2>Thư viện video <span id="video-count" class="pill">0</span></h2></div><div id="video-library" class="asset-grid"></div>`;
}
function scriptMarkup(){
 return `<div class="hero"><div><span class="eyebrow">SCRIPT WRITER</span><h1>Viết kịch bản bằng <span class="hero-accent">DeepSeek / OpenAI.</span></h1></div></div><div class="grid2">
 <section class="panel"><div class="grid2"><div class="field"><label>Nhà cung cấp</label><select id="text-provider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option></select><small id="text-model-label"></small></div><div class="field"><label>Thời lượng</label><select id="script-duration"><option value="30">30 giây</option><option value="60" selected>60 giây</option><option value="90">90 giây</option><option value="180">3 phút</option></select></div></div><div class="field"><label>Phong cách</label><select id="script-style"><option>Tự nhiên, gần gũi</option><option>Giới thiệu sản phẩm rõ ràng</option><option>Kể chuyện, cảm xúc</option><option>Quảng cáo ngắn, mở đầu thu hút</option></select></div><div class="field"><label>Yêu cầu</label><textarea id="script-prompt" rows="9" maxlength="10000"></textarea></div><label class="check"><input id="include-analysis" type="checkbox" checked>Dùng kết quả phân tích video đang chọn.</label><button id="generate-script" class="primary full">Tạo kịch bản</button><p id="script-status" class="status-line"></p></section>
 <section class="panel"><div class="field"><label>Bản thảo</label><textarea id="script-editor" class="script-area" rows="17"></textarea></div><div class="row between"><span id="script-count" class="char-count">0 ký tự</span><button id="export-script" class="small">${icon('down')} TXT</button></div><div class="divider"></div><button id="script-to-voice" class="purple full">Đưa sang tạo giọng Ibee</button></section></div>`;
}
function voiceMarkup(){
 const v=S.session.assignedVoice;
 return `<div class="hero"><div><span class="eyebrow">IBEE AIVOICE</span><h1>Giọng <span class="hero-accent">Nhân bản chuyên nghiệp.</span></h1><p>Tài khoản chỉ sử dụng giọng do admin chỉ định.</p></div><span class="pill green">IBEE</span></div><div class="grid2">
 <section class="panel"><div class="panel-head"><h2>Giọng được cấp</h2>${icon('mic')}</div><div class="notice ${v?'success':'warning'}">${v?`<strong>${esc(v.label)}</strong><br><code>${esc(v.code)}</code>`:'Admin chưa gán giọng cho tài khoản này.'}</div><div class="divider"></div><div class="field"><label>Văn bản cần đọc</label><textarea id="voice-text" rows="12" maxlength="5000"></textarea><small id="voice-count">0 / 5.000 ký tự</small></div><div class="field"><label>Tốc độ</label><select id="voice-speed"><option value="0.85">0,85x</option><option value="1" selected>1x tự nhiên</option><option value="1.15">1,15x</option></select></div><label class="check"><input id="tts-consent" type="checkbox">Tôi đồng ý gửi văn bản cho Ibee để tạo audio.</label><button id="generate-voice" class="purple full" ${v?'':'disabled'}>Tạo MP3 bằng Ibee</button><p id="voice-status" class="status-line"></p></section>
 <section class="panel"><div class="panel-head"><h2>Audio kết quả</h2><span class="pill">MP3</span></div><div id="audio-output" hidden class="audio-output"><audio id="tts-preview" controls></audio><div class="row between"><span id="audio-duration" class="pill green"></span><button id="download-audio" class="small">${icon('down')} Tải MP3</button></div></div><div class="notice">Không có mục clone giọng trên web này. Giọng được tạo và quản lý trong tài khoản Ibee, admin chỉ nhập mã giọng vào ClipLab.</div></section></div>`;
}

function cloneVideoMarkup(){
 const videos=S.assets.filter(a=>a.kind==='video');
 const selected=S.cloneJob?.sourceVideoId||S.selectedVideo||'';
 const voice=S.session.assignedVoice;
 return `<div class="hero"><div><span class="eyebrow">VIDEO VOICE CLONE</span><h1>Clon giọng <span class="hero-accent">Video.</span></h1><p>Giữ nguyên video gốc, thay phần lời nói bằng giọng Ibee đã được cấp và căn sát timeline nguồn.</p></div><span class="pill purple">${icon('magic')} Xử lý tại máy · ≤ 3 phút</span></div>
 <div class="grid2"><section class="panel"><div class="panel-head"><h2>1. Video nguồn</h2>${icon('video')}</div>
 <div class="field"><label>Chọn video trong thư viện</label><select id="clone-source-video"><option value="">-- Chọn video --</option>${videos.map(v=>`<option value="${esc(v.id)}" ${v.id===selected?'selected':''}>${esc(v.name)} · ${clock(v.duration)}</option>`).join('')}</select></div>
 <div id="clone-source-preview" class="camera-box small-preview">${selected&&videos.some(v=>v.id===selected)?`<video controls playsinline src="${esc(blobUrl(videos.find(v=>v.id===selected)))}"></video>`:'<div class="camera-empty"><strong>Chưa chọn video</strong><p>Thêm video ở mục Tư liệu video trước.</p></div>'}</div>
 <div class="notice warning"><strong>Điều kiện tốt nhất:</strong> một người nói chính, tiếng Việt, không hát, không chồng tiếng. Hình ảnh và khẩu hình video gốc được giữ nguyên; độ khớp miệng phụ thuộc mức độ audio Ibee bám sát timeline và nhịp nói nguồn.</div>
 <label class="check"><input id="clone-consent" type="checkbox">Tôi có quyền sử dụng video, hình ảnh và giọng nói này; đồng ý gửi audio cần thiết cho OpenAI và Ibee. Bước ghép video chạy ngay trên trình duyệt.</label>
 <button id="clone-transcribe" class="primary full" ${selected&&voice?'':'disabled'}>Phân tích lời thoại & timeline</button><p id="clone-status" class="status-line"></p></section>
 <section class="panel"><div class="panel-head"><h2>2. Giọng đích</h2>${icon('mic')}</div>
 <div class="field"><label>Giọng Của Tôi</label><select id="clone-target-voice" ${voice?'':'disabled'}>${voice?`<option value="${esc(voice.code)}">${esc(voice.label)}</option>`:'<option>Admin chưa cấp giọng</option>'}</select></div>
 <div class="notice">Module sử dụng đúng voice code Ibee đã được admin cấp. Người dùng không thể nhập voice code khác.</div>
 <div class="divider"></div><div class="row between"><strong>Tiến trình</strong><span id="clone-stage" class="pill">${esc(S.cloneJob?.stage||'Chưa bắt đầu')}</span></div>
 <div class="progress"><div id="clone-progress" style="width:${Number(S.cloneJob?.progress||0)}%"></div></div></section></div>
 <section class="panel" id="clone-transcript-panel" ${S.cloneJob?.segments?.length?'':'hidden'}><div class="panel-head"><div><h2>3. Kiểm tra lời thoại</h2><p class="tiny muted status-line">Sửa sai chính tả nếu cần. Mốc thời gian được khóa để giữ timeline video.</p></div><span class="pill green" id="clone-segment-count">${S.cloneJob?.segments?.length||0} đoạn</span></div>
 <div id="clone-transcript-list" class="stack"></div><div class="row between"><span class="tiny muted">Không đổi nội dung nếu mục tiêu là giữ nguyên lời nguồn.</span><button id="clone-synthesize" class="purple">Tạo giọng theo timeline</button></div></section>
 <section class="panel" id="clone-render-panel" ${S.cloneJob?.alignedAudio?'':'hidden'}><div class="panel-head"><div><h2>4. Ghép giọng vào video</h2><p class="tiny muted status-line">Không chỉnh khuôn mặt hoặc khẩu hình. Video gốc được phát lại và thay track tiếng bằng audio Ibee đã căn timeline.</p></div><span class="pill">Local</span></div>
 <audio id="clone-audio-preview" controls></audio><div class="notice">Bước xuất video chạy theo thời gian thực trên máy. Ví dụ video 60 giây sẽ mất khoảng 60 giây để ghép. Trình duyệt có thể mã hóa lại file nên dung lượng/codec có thể thay đổi, nhưng nội dung hình ảnh không bị AI chỉnh sửa.</div><div class="divider"></div><button id="clone-render-video" class="primary full">Ghép video hoàn chỉnh</button><p id="clone-render-status" class="status-line"></p></section>
 <section class="panel result" id="clone-result-panel" ${S.cloneJob?.resultVideo?.blob?'':'hidden'}><div class="panel-head"><h2>Video kết quả</h2><button id="clone-download-result" class="small">${icon('down')} Tải video</button></div><video id="clone-result-video" controls playsinline></video></section>`;
}
function settingsMarkup(){
 const admin=S.session.role==='admin';
 return `<div class="hero"><div><span class="eyebrow">CONTROL CENTER</span><h1>Thiết lập & <span class="hero-accent">phân quyền.</span></h1></div><button id="refresh-settings" class="small">${icon('refresh')} Làm mới</button></div><div class="grid2">
 <section class="panel"><div class="panel-head"><h2>Kết nối API</h2>${icon('settings')}</div><div id="provider-list" class="provider-grid"></div><div class="divider"></div><div id="limiter-notice" class="notice"></div></section>
 <section class="panel"><div class="panel-head"><h2>An toàn</h2>${icon('shield')}</div><table class="settings-table"><tbody><tr><td>Ibee</td><td>Chỉ dùng giọng admin đã cấp.</td></tr><tr><td>Tài khoản con</td><td>Không thấy API key và không tự đổi voice code.</td></tr><tr><td>Redis</td><td>Cần cho phân quyền nhiều tài khoản trên Vercel.</td></tr></tbody></table><div class="divider"></div><button id="clear-local" class="danger small">${icon('trash')} Xóa media cục bộ</button></section></div>
 ${admin?`<section class="panel admin-panel"><div class="panel-head"><h2>Admin · quản lý giọng và tài khoản</h2><span class="pill purple">ADMIN ONLY</span></div><div id="openai-key-diagnostic" class="notice"></div><div class="grid2"><div><h3>Danh sách giọng Nhân bản chuyên nghiệp</h3><p class="tiny muted status-line">Copy mã giọng từ mục Giọng của tôi trên Ibee. Chỉ thêm các giọng Nhân bản chuyên nghiệp mà tài khoản Ibee của anh có quyền sử dụng.</p><div class="field"><label>Tên hiển thị</label><input id="admin-voice-label" maxlength="80" placeholder="Giọng Nhung Pro"></div><div class="field"><label>Voice code Ibee</label><input id="admin-voice-code" maxlength="180" placeholder="Mã giọng đã copy từ Ibee"></div><button id="admin-add-voice" class="primary">Thêm giọng</button><div class="divider"></div><div id="admin-voices" class="stack"></div></div><div><h3>Gán giọng theo tài khoản</h3><p class="tiny muted status-line">Mỗi tài khoản chỉ thấy và dùng giọng được chọn ở đây.</p><div id="admin-users" class="stack"></div></div></div></section>`:''}`;
}
function renderApp(){
 $('#login-screen').hidden=true;$('#app').hidden=false;
 const navItems=[['media',pages.media,'video'],['script',pages.script,'pen'],['voice',pages.voice,'mic'],['clone',pages.clone,'magic'],['settings',pages.settings,'settings']].filter(([p])=>canOpenPage(p));
 const nav=navItems.map(([p,label,ico])=>`<button data-page="${p}" class="${p==='media'?'active':''}">${icon(ico)}<span>${label}</span></button>`).join('');
 $('#app').innerHTML=`<aside class="sidebar"><div class="brand">${logo}<div><strong>cliplab<span class="hero-accent">.</span></strong><small>IBEE CREATOR STUDIO</small></div></div><div class="workspace"><span class="avatar">${esc(S.session.username.slice(0,2).toUpperCase())}</span><div><strong>${esc(S.session.username)}</strong><p class="tiny muted">${esc(S.session.role)}</p></div></div><p class="nav-label">CHỨC NĂNG</p><nav class="nav">${nav}</nav><div class="sidebar-bottom"><div class="free-card"><span class="pill green">IBEE API</span><h3>Giọng theo phân quyền</h3><p>Admin cấp giọng cho từng tài khoản con.</p></div></div></aside><main class="main"><header class="topbar"><div class="crumb"><strong id="breadcrumb">Tư liệu video</strong></div><div class="user-badge"><span class="pill ${S.session.role==='admin'?'purple':'green'}">${esc(S.session.role)}</span><strong>${esc(S.session.username)}</strong><button id="logout" class="small">${icon('logout')}</button></div></header><div class="content"><div id="page-media">${mediaMarkup()}</div><div id="page-script" hidden>${scriptMarkup()}</div><div id="page-voice" hidden>${voiceMarkup()}</div><div id="page-clone" hidden>${cloneVideoMarkup()}</div><div id="page-settings" hidden>${settingsMarkup()}</div></div></main>`;
}
function navigate(page){
 if(!pages[page]||!canOpenPage(page)||S.camera.recording)return;
 S.page=page;if(page!=='media'&&S.camera.stream)closeCamera();
 for(const p of Object.keys(pages))$('#page-'+p).hidden=p!==page;
 $$('.nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 $('#breadcrumb').textContent=pages[page];window.scrollTo({top:0});
 if(page==='settings')renderSettings();if(page==='clone')renderCloneState();
}
function videoAsset(){return S.assets.find(a=>a.id===S.selectedVideo&&a.kind==='video')}
function requireConsent(sel){if(!$(sel).checked)throw new Error('Hãy xác nhận quyền sử dụng dữ liệu.')}
function ensureProvider(p){if(!S.session.providers[p])throw new Error('Chưa cấu hình API '+p+'.')}
function updateCounts(){
 const s=$('#script-editor')?.value||'',v=$('#voice-text')?.value||'';
 if($('#script-count'))$('#script-count').textContent=`${s.length.toLocaleString('vi-VN')} ký tự`;
 if($('#voice-count'))$('#voice-count').textContent=`${v.length.toLocaleString('vi-VN')} / 5.000 ký tự`;
}
function renderVideoLibrary(){
 const videos=S.assets.filter(a=>a.kind==='video');$('#video-count').textContent=videos.length;
 $('#video-library').innerHTML=videos.length?videos.map(v=>`<article class="asset-card ${v.id===S.selectedVideo?'selected':''}"><div class="asset-thumb"><video src="${esc(blobUrl(v))}" muted preload="metadata"></video><span class="duration">${clock(v.duration)}</span></div><div class="asset-body"><div class="asset-title">${esc(v.name)}</div><div class="asset-meta">${size(v.blob.size)}</div><div class="asset-actions"><button class="small" data-select-video="${v.id}">Chọn</button><button class="small danger" data-delete-asset="${v.id}">Xóa</button></div></div></article>`).join(''):'<div class="empty">Chưa có video.</div>';
}
function selectVideo(id){
 S.selectedVideo=id;const v=videoAsset(),player=$('#camera-video');
 if(v){player.srcObject=null;player.src=blobUrl(v);player.controls=true;player.muted=false;$('#camera-empty').hidden=true;$('#analysis-source').textContent=`${v.name} · ${clock(v.duration)} · ${size(v.blob.size)}`;}
 else{player.removeAttribute('src');player.load();player.controls=false;$('#camera-empty').hidden=false;$('#analysis-source').textContent='Chưa chọn video.';}
 renderVideoLibrary();showAnalysis(v?.analysis);
}
async function ingestVideo(file,hint=0){
 if(file.size>80*1024*1024)throw new Error('Video vượt 80 MB.');
 const mime=cleanMime(file);if(!['video/mp4','video/webm','video/quicktime','video/x-m4v'].includes(mime))throw new Error('Chỉ hỗ trợ MP4, WebM, MOV.');
 const duration=hint||await durationOf(file,'video');if(duration<0.1||duration>180)throw new Error('Video cần dài 0,1-180 giây.');
 const rec={id:crypto.randomUUID(),name:file.name,kind:'video',blob:new Blob([file],{type:mime}),duration,createdAt:Date.now()};
 await put('assets',rec);S.assets=await all('assets');selectVideo(rec.id);toast('Đã thêm video.');
}
function showAnalysis(r){
 $('#analysis-result').hidden=!r;if(!r)return;
 $('#analysis-summary').textContent=r.summary||'';$('#analysis-script').value=r.script||'';
 $('#analysis-scenes').innerHTML=(r.scenes||[]).map(x=>`<div class="scene"><time>${esc(x.time)}</time><div><p>${esc(x.visual)}</p><p class="suggestion">${esc(x.suggestion)}</p></div></div>`).join('');
}
async function runAnalysis(){
 ensureProvider('google');requireConsent('#analysis-consent');const v=videoAsset();if(!v)throw new Error('Chọn video trước.');
 const mode=$('input[name="analysis-mode"]:checked').value,payload={mode,duration:v.duration,brief:$('#analysis-brief').value,consent:true};let fileToken;
 const progress=(n,msg)=>{$('#analysis-progress').hidden=false;$('#analysis-progress>div').style.width=n+'%';$('#analysis-status').textContent=msg};
 try{
  if(mode==='frames'){payload.frames=await sampleFrames(v.blob,v.duration,Number($('#frame-count').value),(n,m)=>progress(Math.round(n/m*55),`Lấy khung hình ${n}/${m}`));}
  else{
   const init=await api('google-start',{size:v.blob.size,duration:v.duration,mime:v.blob.type,consent:true});let ticket=init.ticket;
   for(let off=0;off<v.blob.size;off+=init.chunkSize){const chunk=v.blob.slice(off,off+init.chunkSize);const rr=await fetch('/api/index?action=google-chunk',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream','X-Upload-Ticket':ticket},body:chunk});const d=await rr.json();if(!rr.ok)throw new Error(d.error||'Upload Google lỗi');if(d.ticket)ticket=d.ticket;if(d.fileToken)fileToken=d.fileToken;progress(Math.round((off+chunk.size)/v.blob.size*60),'Đang tải video...');}
   for(let i=0;i<60;i++){const f=await api('google-file',{fileToken});if(f.state==='ACTIVE')break;if(f.state==='FAILED')throw new Error('Google không xử lý được video.');await pause(1500);}
   payload.fileToken=fileToken;
  }
  progress(75,'AI đang phân tích...');const result=await api('analysis',payload);v.analysis=result;await put('assets',v);showAnalysis(result);renderVideoLibrary();progress(100,'Hoàn tất');
 }finally{$('#analysis-progress').hidden=true;if(fileToken){try{await api('google-delete',{fileToken})}catch{}}}
}
function showAudio(rec){S.latestAudio=rec;$('#audio-output').hidden=false;const player=$('#tts-preview');player.pause();player.removeAttribute('src');player.src=rec.playUrl||rec.remoteUrl||blobUrl(rec);player.load();$('#audio-duration').textContent=rec.playUrl?'Sẵn sàng nghe':rec.remoteUrl?'Link Ibee tạm thời':clock(rec.duration);player.onloadedmetadata=()=>{if(Number.isFinite(player.duration)&&player.duration>0)$('#audio-duration').textContent=clock(player.duration)};player.onerror=()=>{$('#audio-duration').textContent='Không tải được audio';$('#voice-status').textContent='Không phát được audio trực tiếp. Hãy thử lại hoặc tải MP3.'}}

function cloneSourceVideo(){
 const id=S.cloneJob?.sourceVideoId||$('#clone-source-video')?.value||S.selectedVideo;
 return S.assets.find(a=>a.id===id&&a.kind==='video')||null;
}
function newCloneJob(sourceVideoId=''){
 return {id:'video-voice-clone-current',type:'video-voice-clone',sourceVideoId,stage:'Chưa bắt đầu',progress:0,segments:[],alignedAudio:null,resultVideo:null,createdAt:Date.now(),updatedAt:Date.now()};
}
async function saveCloneJob(){
 if(!S.cloneJob)return;
 S.cloneJob.updatedAt=Date.now();
 await put('jobs',S.cloneJob);
}
function setCloneProgress(stage,progress,status=''){
 if(!S.cloneJob)S.cloneJob=newCloneJob();
 S.cloneJob.stage=stage;S.cloneJob.progress=Math.max(0,Math.min(100,Math.round(progress)));
 if($('#clone-stage'))$('#clone-stage').textContent=stage;
 if($('#clone-progress'))$('#clone-progress').style.width=S.cloneJob.progress+'%';
 if(status&&$('#clone-status'))$('#clone-status').textContent=status;
}
function normalizeWordText(words){
 return words.map(w=>String(w.word||'').trim()).filter(Boolean).join(' ')
  .replace(/\s+([,.;:!?…])/g,'$1').replace(/([“"'(\[])\s+/g,'$1').replace(/\s+([”"')\]])/g,'$1').trim();
}
function splitLongCloneSegment(segment,words){
 if(segment.end-segment.start<=5.2)return [segment];
 const inside=words.filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.word&&w.start>=segment.start-.12&&w.end<=segment.end+.12).sort((a,b)=>a.start-b.start);
 if(inside.length<3)return [segment];
 const groups=[];let group=[];let groupStart=inside[0].start;
 for(let i=0;i<inside.length;i++){
  const word=inside[i];group.push(word);
  const next=inside[i+1];
  const span=word.end-groupStart;
  const pause=next?next.start-word.end:0;
  const punct=/[.!?…,:;]$/.test(String(word.word||'').trim());
  const shouldBreak=!next||span>=4.2||(span>=1.8&&(pause>=.22||punct));
  if(shouldBreak){
   const text=normalizeWordText(group);
   if(text)groups.push({id:segment.id+'-'+groups.length,start:group[0].start,end:group.at(-1).end,text});
   group=[];if(next)groupStart=next.start;
  }
 }
 return groups.length>1?groups:[segment];
}
function normalizeCloneSegments(rows,words,duration){
 const cleanWords=(words||[]).filter(w=>w&&typeof w.word==='string'&&w.word.trim()&&Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start)
  .map(w=>({start:Math.max(0,Number(w.start)),end:Math.min(duration,Number(w.end)),word:w.word.trim()})).filter(w=>w.end>w.start);
 const base=rows.filter(x=>x&&typeof x.text==='string'&&x.text.trim()&&Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start)
  .map((x,i)=>({id:x.id||String(i),start:Math.max(0,Number(x.start)),end:Math.min(duration,Number(x.end)),text:x.text.trim()}))
  .filter(x=>x.end>x.start).sort((a,b)=>a.start-b.start);
 const segments=base.flatMap(s=>splitLongCloneSegment(s,cleanWords)).sort((a,b)=>a.start-b.start);
 while(segments.length>60){
  let best=0,bestGap=Infinity;
  for(let i=0;i<segments.length-1;i++){const gap=Math.max(0,segments[i+1].start-segments[i].end);if(gap<bestGap){bestGap=gap;best=i}}
  const a=segments[best],b=segments[best+1];
  segments.splice(best,2,{id:a.id,start:a.start,end:b.end,text:(a.text+' '+b.text).trim()});
 }
 return segments.map((x,i)=>({...x,id:'seg-'+i,start:Number(x.start.toFixed(3)),end:Number(x.end.toFixed(3))}));
}
function renderCloneState(){
 const job=S.cloneJob;
 if(!$('#page-clone'))return;
 if($('#clone-stage'))$('#clone-stage').textContent=job?.stage||'Chưa bắt đầu';
 if($('#clone-progress'))$('#clone-progress').style.width=Number(job?.progress||0)+'%';
 const list=$('#clone-transcript-list');
 if(list){
  const segs=job?.segments||[];
  $('#clone-transcript-panel').hidden=!segs.length;
  $('#clone-segment-count').textContent=segs.length+' đoạn';
  list.innerHTML=segs.map((s,i)=>`<div class="voice-card clone-segment"><div class="row between"><strong>Đoạn ${i+1}</strong><span class="pill">${clock(s.start)} → ${clock(s.end)} · ${Math.max(.1,s.end-s.start).toFixed(1)}s</span></div><textarea data-clone-segment="${i}" rows="2" maxlength="1000">${esc(s.text)}</textarea></div>`).join('');
 }
 const panel=$('#clone-render-panel');
 if(panel){
  panel.hidden=!job?.alignedAudio?.blob;
  const player=$('#clone-audio-preview');
  if(job?.alignedAudio?.blob&&player){player.src=blobUrl(job.alignedAudio);player.load()}
 }
 const result=$('#clone-result-panel');
 if(result){
  result.hidden=!job?.resultVideo?.blob;
  if(job?.resultVideo?.blob){const u=blobUrl(job.resultVideo);$('#clone-result-video').src=u;$('#clone-result-video').load()}
 }
}
async function transcribeCloneVideo(){
 ensureProvider('openai');requireConsent('#clone-consent');
 const source=cloneSourceVideo();if(!source)throw new Error('Hãy chọn video nguồn.');
 if(!S.session.assignedVoice)throw new Error('Admin chưa cấp giọng cho tài khoản này.');
 S.cloneJob=newCloneJob(source.id);setCloneProgress('Tách lời thoại',5,'Đang tách audio khỏi video...');
 const extracted=await extractSpeechChunks(source.blob,40,(n,total)=>setCloneProgress('Tách lời thoại',5+Math.round(n/total*10)));
 const rows=[],words=[];
 for(let i=0;i<extracted.chunks.length;i++){
  const chunk=extracted.chunks[i];
  setCloneProgress('Nhận dạng lời thoại',15+Math.round(i/extracted.chunks.length*35),`Đang nhận dạng đoạn ${i+1}/${extracted.chunks.length}...`);
  const data=await api('clone-transcribe',{audioBase64:await toBase64(chunk.blob),offset:chunk.offset,duration:chunk.duration,consent:true});
  rows.push(...(data.segments||[]));words.push(...(data.words||[]));
 }
 const segments=normalizeCloneSegments(rows,words,source.duration);
 if(!segments.length)throw new Error('Không nhận thấy lời thoại tiếng Việt rõ ràng trong video.');
 S.cloneJob.segments=segments;S.cloneJob.sourceDuration=source.duration;S.cloneJob.alignedAudio=null;S.cloneJob.resultVideo=null;
 setCloneProgress('Chờ kiểm tra lời thoại',50,`Đã nhận dạng ${segments.length} đoạn. Hãy kiểm tra nội dung trước khi tạo giọng.`);
 await saveCloneJob();renderCloneState();
}
async function waitIbee(token,label){
 let state=null;
 for(let i=0;i<100;i++){
  await pause(i<10?1200:2000);
  state=await api('tts-status',{token});
  if(state.failed)throw new Error(state.error||'Ibee tạo audio thất bại.');
  if(state.ready)return state;
  if($('#clone-status'))$('#clone-status').textContent=`${label}: Ibee đang xử lý...`;
 }
 throw new Error('Ibee xử lý quá lâu. Hãy thử lại tác vụ sau.');
}
async function fetchIbeeAudio(token){
 const r=await fetch(`/api/index?action=tts-audio&token=${encodeURIComponent(token)}`,{credentials:'same-origin',signal:AbortSignal.timeout(65000)});
 if(!r.ok){let d={};try{d=await r.json()}catch{}throw new Error(d.error||'Không tải được audio Ibee.')}
 return r.blob();
}
async function synthesizeCloneSegment(seg,index,total,initialSpeed=1){
 const target=Math.max(.45,seg.end-seg.start);
 let speed=Math.max(.25,Math.min(1.9,Number(initialSpeed)||1));
 let best=null;
 const tolerance=Math.max(.07,target*.025);
 for(let attempt=0;attempt<3;attempt++){
  setCloneProgress('Tạo giọng Ibee',52+Math.round((index+(attempt*.22))/total*30),`Đoạn ${index+1}/${total}: căn thời lượng ${speed.toFixed(2)}x...`);
  const sub=await api('tts-submit',{text:seg.text,speed,consent:true});
  await waitIbee(sub.token,`Đoạn ${index+1}/${total}`);
  const raw=await fetchIbeeAudio(sub.token);
  const speech=await trimSpeechAudio(raw);
  const duration=speech.duration;
  const error=duration-target;
  const absError=Math.abs(error);
  const candidate={blob:speech.blob,duration,speed,error,trimmed:speech.trimmed,leading:speech.leading,trailing:speech.trailing};
  if(!best||absError<Math.abs(best.error))best=candidate;
  if(absError<=tolerance)break;

  const ratio=duration/target;
  const next=Math.max(.25,Math.min(1.9,speed*ratio));
  if(Math.abs(next-speed)<.015)break;
  speed=Number(next.toFixed(3));
 }
 if(!best)throw new Error(`Không tạo được audio cho đoạn ${index+1}.`);
 const maxAllowed=Math.max(.16,target*.045);
 if(Math.abs(best.error)>maxAllowed){
  const direction=best.error<0?'nhanh':'chậm';
  throw new Error(`Đoạn ${index+1} vẫn ${direction} lệch ${Math.abs(best.error).toFixed(2)}s sau khi tự căn tốc độ. Hãy kiểm tra lời thoại đoạn này.`);
 }
 return {start:seg.start,end:seg.end,text:seg.text,blob:best.blob,duration:best.duration,speed:best.speed,timingError:best.error};
}
async function synthesizeCloneTimeline(){
 ensureProvider('vbee');requireConsent('#clone-consent');
 if(!S.cloneJob?.segments?.length)throw new Error('Hãy phân tích lời thoại trước.');
 const source=cloneSourceVideo();if(!source)throw new Error('Video nguồn không còn trong thư viện.');
 $$('#clone-transcript-list [data-clone-segment]').forEach(el=>{const i=Number(el.dataset.cloneSegment);if(S.cloneJob.segments[i])S.cloneJob.segments[i].text=el.value.trim()});
 if(S.cloneJob.segments.some(s=>!s.text))throw new Error('Không được để trống lời thoại.');
 await saveCloneJob();
 const audio=[];let calibratedSpeed=1;
 for(let i=0;i<S.cloneJob.segments.length;i++){
  const fitted=await synthesizeCloneSegment(S.cloneJob.segments[i],i,S.cloneJob.segments.length,calibratedSpeed);
  audio.push(fitted);
  calibratedSpeed=Math.max(.25,Math.min(1.9,calibratedSpeed*.35+fitted.speed*.65));
 }
 setCloneProgress('Dựng timeline audio',84,'Đang đặt từng câu vào đúng mốc thời gian...');
 const aligned=await composeAlignedSpeech(audio,source.duration,(n,total)=>setCloneProgress('Dựng timeline audio',84+Math.round(n/total*6)));
 const maxError=Math.max(...audio.map(x=>Math.abs(x.timingError||0)));
 const avgError=audio.reduce((sum,x)=>sum+Math.abs(x.timingError||0),0)/audio.length;
 S.cloneJob.alignedAudio={id:'clone-aligned-'+Date.now(),kind:'audio',blob:aligned.blob,duration:aligned.duration,createdAt:Date.now(),maxTimingError:maxError,avgTimingError:avgError,calibratedSpeed};
 S.cloneJob.segmentAudio=[];S.cloneJob.resultVideo=null;
 setCloneProgress('Sẵn sàng ghép video',90,`Đã khóa timeline. Sai lệch lớn nhất ${maxError.toFixed(2)}s · trung bình ${avgError.toFixed(2)}s. Nghe thử trước khi ghép.`);
 await saveCloneJob();renderCloneState();
}
async function renderCloneVideo(){
 requireConsent('#clone-consent');
 const source=cloneSourceVideo();if(!source||!S.cloneJob?.alignedAudio?.blob)throw new Error('Cần video nguồn và audio timeline.');
 setCloneProgress('Ghép video',91,'Đang giữ nguyên hình ảnh video và thay track tiếng. Không đóng tab trong lúc xử lý...');
 const result=await replaceVideoAudio(source.blob,S.cloneJob.alignedAudio.blob,source.duration,(current,total)=>{
   const pct=91+Math.round(Math.min(1,current/Math.max(.1,total))*8);
   setCloneProgress('Ghép video',pct,`Đang xuất video... ${clock(current)} / ${clock(total)}`);
 });
 const rec={id:'clone-result-'+Date.now(),kind:'clone-result',name:`video-clon-giong-${Date.now()}.${result.extension}`,blob:result.blob,duration:result.duration,mime:result.mime,createdAt:Date.now()};
 S.cloneJob.resultVideo=rec;
 setCloneProgress('Hoàn tất',100,`Đã ghép giọng vào video. Định dạng: ${result.extension.toUpperCase()}.`);
 await saveCloneJob();renderCloneState();
}

function renderSettings(){
 const cfg=S.session;
 const defs=[['vbee','Ibee AIVoice','Cấu hình API phía máy chủ'],['google','Google Gemini','GOOGLE_API_KEY'],['deepseek','DeepSeek','DEEPSEEK_API_KEY'],['openai','OpenAI','OPENAI_API_KEY']];
 $('#provider-list').innerHTML=defs.map(([id,n,e])=>`<div class="provider"><h3>${n}</h3><span class="pill ${cfg.providers[id]?'green':''}">${cfg.providers[id]?'Đã cấu hình':'Chưa cấu hình'}</span><code>${e}</code></div>`).join('');
 $('#limiter-notice').textContent=cfg.limiter==='redis'?'Redis đã kết nối: có thể lưu phân quyền giọng cho nhiều tài khoản.':'Chưa có Upstash Redis: tạo nội dung đa tài khoản và gán giọng sẽ bị chặn để tránh vượt hạn mức.';
 $('#limiter-notice').className=`notice ${cfg.limiter==='redis'?'success':'warning'}`;
 const p=$('#text-provider')?.value||'deepseek';if($('#text-model-label'))$('#text-model-label').textContent=`${cfg.models[p]} · ${cfg.providers[p]?'đã có key':'chưa có key'}`;
 if(cfg.role==='admin')loadAdminState();
}
async function loadAdminState(){
 try{S.adminState=await api('admin-state',{});renderAdmin()}catch(e){toast(e.message,true)}
}
function renderAdmin(){
 if(!S.adminState||!$('#admin-users'))return;const voices=S.adminState.voices||[];const oa=S.adminState.diagnostics?.openai;if($('#openai-key-diagnostic')){$('#openai-key-diagnostic').className=`notice ${oa?.configured?'success':'warning'}`;$('#openai-key-diagnostic').textContent=oa?.configured?`OpenAI key production đang đọc: ${oa.hint} · ${oa.length} ký tự${oa.normalized?' · đã tự bỏ khoảng trắng/dấu nháy':''}`:'OpenAI key chưa được cấu hình.';}
 $('#admin-voices').innerHTML=voices.length?voices.map(v=>`<div class="voice-card"><div class="row between"><div><strong>${esc(v.label)}</strong><br><code>${esc(v.code)}</code></div><button class="small danger" data-remove-pro-voice="${esc(v.code)}">Xóa</button></div></div>`).join(''):'<div class="empty">Chưa thêm giọng chuyên nghiệp.</div>';
 $('#admin-users').innerHTML=(S.adminState.users||[]).map(u=>`<div class="voice-card"><div class="row between"><strong>${esc(u.username)}</strong><span class="pill">${esc(u.role)}</span></div><div class="field"><select data-assign-user="${esc(u.username)}"><option value="">-- Chưa cấp giọng --</option>${voices.map(v=>`<option value="${esc(v.code)}" ${u.voiceCode===v.code?'selected':''}>${esc(v.label)}</option>`).join('')}</select></div></div>`).join('');
}
function applyCameraRatioUI(){
 const box=$('#camera-box'),ratio=$('#camera-ratio');if(!box||!ratio)return;
 const portrait=ratio.value==='portrait';
 box.classList.toggle('portrait',portrait);box.classList.toggle('landscape',!portrait);
}
function closeCamera(){S.camera.close();const p=$('#camera-video');if(!p)return;p.srcObject=null;$('#open-camera').disabled=false;$('#start-record').disabled=true;$('#close-camera').hidden=true;if(!videoAsset())$('#camera-empty').hidden=false}
function bindCloneEvents(){
 const transcribe=$('#clone-transcribe');if(transcribe)transcribe.onclick=()=>busy(transcribe,transcribeCloneVideo,'#clone-status');
 const synth=$('#clone-synthesize');if(synth)synth.onclick=()=>busy(synth,synthesizeCloneTimeline,'#clone-status');
 const render=$('#clone-render-video');if(render)render.onclick=()=>busy(render,renderCloneVideo,'#clone-render-status');
 const dl=$('#clone-download-result');if(dl)dl.onclick=()=>{const v=S.cloneJob?.resultVideo;if(v?.blob)download(v.blob,v.name||'video-clon-giong.webm')};
 const source=$('#clone-source-video');if(source)source.onchange=async e=>{const id=e.target.value;if(!S.cloneJob||S.cloneJob.sourceVideoId!==id){S.cloneJob=newCloneJob(id);await saveCloneJob();const page=$('#page-clone');page.innerHTML=cloneVideoMarkup();bindCloneEvents();renderCloneState()}};
}
function bindEvents(){
 $('#app').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.page)return navigate(b.dataset.page);
  if(b.dataset.selectVideo)return selectVideo(b.dataset.selectVideo);
  if(b.dataset.deleteAsset)return busy(b,async()=>{await remove('assets',b.dataset.deleteAsset);S.assets=await all('assets');if(S.selectedVideo===b.dataset.deleteAsset)S.selectedVideo=S.assets.find(a=>a.kind==='video')?.id||null;selectVideo(S.selectedVideo)});
  if(b.dataset.removeProVoice)return busy(b,async()=>{await api('admin-remove-voice',{code:b.dataset.removeProVoice});await loadAdminState();toast('Đã xóa giọng khỏi danh sách.')});
 };
 $('#app').onchange=e=>{const el=e.target.closest('[data-assign-user]');if(!el)return;const username=el.dataset.assignUser,voiceCode=el.value;el.disabled=true;(async()=>{try{await api('admin-assign-voice',{username,voiceCode});await loadAdminState();if(username===S.session.username)S.session=await api('session');toast('Đã cập nhật giọng cho '+username)}catch(err){toast(err.message||'Không thể cập nhật giọng.',true);await loadAdminState()}finally{if(document.body.contains(el))el.disabled=false}})()};
 $('#open-camera').onclick=()=>busy($('#open-camera'),async()=>{const portrait=$('#camera-ratio').value==='portrait';applyCameraRatioUI();const stream=await S.camera.open({facing:$('#camera-facing').value,portrait,audio:$('#camera-audio').checked});const p=$('#camera-video');p.removeAttribute('src');p.srcObject=stream;p.controls=false;p.muted=true;await p.play();$('#camera-empty').hidden=true;$('#start-record').disabled=false;$('#close-camera').hidden=false;$('#camera-status').textContent=portrait?'Camera đang xuất khung dọc thật 720×1280 (9:16).':'Camera đang ở khung ngang 16:9.'});
 $('#start-record').onclick=()=>busy($('#start-record'),async()=>{$('#stop-record').hidden=false;$('#record-time').hidden=false;try{const rr=await S.camera.start(179,t=>$('#record-time').textContent='REC '+clock(t));const ext=rr.blob.type.includes('mp4')?'mp4':'webm';await ingestVideo(new File([rr.blob],`tu-lieu-${Date.now()}.${ext}`,{type:rr.blob.type}),rr.duration);$('#camera-status').textContent=rr.portrait?'Đã lưu video dọc 720×1280 (9:16).':'Đã lưu video ngang.'}finally{$('#stop-record').hidden=true;$('#record-time').hidden=true;closeCamera()}});
 $('#stop-record').onclick=()=>S.camera.stop();$('#close-camera').onclick=()=>{closeCamera();selectVideo(S.selectedVideo)};$('#camera-ratio').onchange=()=>{const wasOpen=!!S.camera.stream;applyCameraRatioUI();if(wasOpen){closeCamera();$('#camera-status').textContent='Đã đổi tỷ lệ khung hình. Bấm Mở camera để áp dụng '+($('#camera-ratio').value==='portrait'?'9:16':'16:9')+'.'}};
 $('#choose-video').onclick=()=>$('#video-file').click();$('#video-file').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)busy($('#choose-video'),()=>ingestVideo(f),'#camera-status')};
 applyCameraRatioUI();
 bindCloneEvents();
 $$('input[name="analysis-mode"]').forEach(x=>x.onchange=()=>$('#frame-field').hidden=x.value!=='frames');
 $('#analyze-btn').onclick=()=>busy($('#analyze-btn'),runAnalysis,'#analysis-status');
 $('#analysis-to-script').onclick=()=>{$('#script-editor').value=$('#analysis-script').value;saveDraft();updateCounts();navigate('script')};
 $('#text-provider').onchange=()=>renderSettings();
 $('#generate-script').onclick=()=>busy($('#generate-script'),async()=>{const p=$('#text-provider').value;ensureProvider(p);const r=await api('text',{provider:p,prompt:$('#script-prompt').value,duration:Number($('#script-duration').value),style:$('#script-style').value,context:$('#include-analysis').checked&&videoAsset()?.analysis?JSON.stringify(videoAsset().analysis):''});$('#script-editor').value=r.text;saveDraft();updateCounts();$('#script-status').textContent='Đã tạo bằng '+r.model},'#script-status');
 for(const s of ['#script-editor','#script-prompt','#voice-text','#analysis-brief'])$(s).oninput=()=>{saveDraft();updateCounts()};
 $('#export-script').onclick=()=>download(new Blob([$('#script-editor').value],{type:'text/plain;charset=utf-8'}),'kich-ban.txt');
 $('#script-to-voice').onclick=()=>{const t=$('#script-editor').value;if(!t.trim()||t.length>5000)return toast('Kịch bản cần 1-5.000 ký tự.',true);$('#voice-text').value=t;saveDraft();updateCounts();navigate('voice')};
 $('#generate-voice').onclick=()=>busy($('#generate-voice'),async()=>{ensureProvider('vbee');requireConsent('#tts-consent');$('#voice-status').textContent='Đang gửi nội dung sang Ibee...';const sub=await api('tts-submit',{text:$('#voice-text').value,speed:Number($('#voice-speed').value),consent:true});let state=null;for(let i=0;i<120;i++){await pause(i<8?1500:2500);state=await api('tts-status',{token:sub.token});if(state.failed)throw new Error(state.error||'Ibee tạo audio thất bại.');if(state.ready)break;$('#voice-status').textContent=`Ibee đang xử lý... ${i+1}/120`}if(!state?.ready||!state.audioLink)throw new Error('Ibee xử lý lâu hơn dự kiến. Hãy thử lại sau ít phút.');const playUrl=`/api/index?action=tts-audio&token=${encodeURIComponent(sub.token)}`;const rec={id:crypto.randomUUID(),name:`ibee-${Date.now()}.mp3`,kind:'audio',playUrl,remoteUrl:state.audioLink,source:'ibee',createdAt:Date.now()};showAudio(rec);$('#voice-status').textContent=`Đã tạo bằng ${sub.voice.label}. Bấm Play để nghe trực tiếp hoặc Tải MP3.`},'#voice-status');
 $('#download-audio').onclick=()=>{if(!S.latestAudio)return;if(S.latestAudio.remoteUrl){const a=document.createElement('a');a.href=S.latestAudio.remoteUrl;a.target='_blank';a.rel='noopener noreferrer';a.download=S.latestAudio.name||'vbee-audio.mp3';document.body.appendChild(a);a.click();a.remove()}else if(S.latestAudio.blob)download(S.latestAudio.blob,S.latestAudio.name)};
 $('#refresh-settings').onclick=()=>busy($('#refresh-settings'),async()=>{S.session=await api('session');renderSettings();toast('Đã làm mới cấu hình.')});
 $('#clear-local').onclick=()=>busy($('#clear-local'),async()=>{if(!confirm('Xóa toàn bộ video/audio/job lưu trên trình duyệt của tài khoản này?'))return;await clear('assets');await clear('jobs');S.assets=[];S.selectedVideo=null;S.latestAudio=null;S.cloneJob=newCloneJob();renderVideoLibrary();selectVideo(null);renderCloneState();$('#audio-output')?.setAttribute('hidden','')});
 if($('#admin-add-voice'))$('#admin-add-voice').onclick=()=>busy($('#admin-add-voice'),async()=>{await api('admin-add-voice',{label:$('#admin-voice-label').value,code:$('#admin-voice-code').value});$('#admin-voice-label').value='';$('#admin-voice-code').value='';await loadAdminState();toast('Đã thêm giọng Ibee chuyên nghiệp.')});
 $('#logout').onclick=()=>busy($('#logout'),async()=>{closeCamera();await api('logout',{});releaseUrls();S.session=null;$('#app').innerHTML='';loginScreen()});
}
async function boot(){
 S.session=await api('session');await initDB(S.session.username);S.assets=await all('assets');S.selectedVideo=S.assets.find(a=>a.kind==='video')?.id||null;const jobs=await all('jobs');S.cloneJob=jobs.find(j=>j.type==='video-voice-clone')||newCloneJob(S.selectedVideo||'');S.page='media';
 renderApp();bindEvents();
 try{const d=JSON.parse(localStorage.getItem(draftKey())||'{}');$('#script-prompt').value=d.prompt||'';$('#script-editor').value=d.script||'';$('#voice-text').value=d.voice||'';$('#analysis-brief').value=d.brief||''}catch{}
 if(!S.session.providers.deepseek&&S.session.providers.openai)$('#text-provider').value='openai';
 renderVideoLibrary();selectVideo(S.selectedVideo);renderCloneState();if(S.session.role==='admin')renderSettings();updateCounts();
 const latest=S.assets.filter(a=>a.kind==='audio').sort((a,b)=>b.createdAt-a.createdAt)[0];if(latest)showAudio(latest);
}
loginScreen();
boot().catch(e=>{S.session=null;if(e.status!==401){loginScreen();$('#login-error').textContent=e.message}});
window.addEventListener('beforeunload',e=>{if(S.camera.recording||S.progress.size){e.preventDefault();e.returnValue=''}});
