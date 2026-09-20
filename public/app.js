import { initDB, put, all, remove, clear, blobUrl, releaseUrls, download, pause, cleanMime, durationOf, sampleFrames, Recorder } from './media.js';

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
const S={session:null,page:'media',assets:[],selectedVideo:null,camera:new Recorder(),progress:new Set(),latestAudio:null,adminState:null};
const pages={media:'Tư liệu video',script:'Viết kịch bản',voice:'Tên Giọng của Tôi',settings:'Thiết lập'};
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
 <div class="camera-box"><video id="camera-video" playsinline muted></video><div class="camera-empty" id="camera-empty"><span class="camera-symbol">${icon('video')}</span><strong>Quay tư liệu mới</strong><p>Hoặc tải video có sẵn bên dưới.</p></div><span id="record-time" class="rec-badge" hidden>REC 00:00</span></div>
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
function settingsMarkup(){
 const admin=S.session.role==='admin';
 return `<div class="hero"><div><span class="eyebrow">CONTROL CENTER</span><h1>Thiết lập & <span class="hero-accent">phân quyền.</span></h1></div><button id="refresh-settings" class="small">${icon('refresh')} Làm mới</button></div><div class="grid2">
 <section class="panel"><div class="panel-head"><h2>Kết nối API</h2>${icon('settings')}</div><div id="provider-list" class="provider-grid"></div><div class="divider"></div><div id="limiter-notice" class="notice"></div></section>
 <section class="panel"><div class="panel-head"><h2>An toàn</h2>${icon('shield')}</div><table class="settings-table"><tbody><tr><td>Ibee</td><td>Chỉ dùng giọng admin đã cấp.</td></tr><tr><td>Tài khoản con</td><td>Không thấy API key và không tự đổi voice code.</td></tr><tr><td>Redis</td><td>Cần cho phân quyền nhiều tài khoản trên Vercel.</td></tr></tbody></table><div class="divider"></div><button id="clear-local" class="danger small">${icon('trash')} Xóa media cục bộ</button></section></div>
 ${admin?`<section class="panel admin-panel"><div class="panel-head"><h2>Admin · quản lý giọng và tài khoản</h2><span class="pill purple">ADMIN ONLY</span></div><div class="grid2"><div><h3>Danh sách giọng Nhân bản chuyên nghiệp</h3><p class="tiny muted status-line">Copy mã giọng từ mục Giọng của tôi trên Ibee. Chỉ thêm các giọng Nhân bản chuyên nghiệp mà tài khoản Ibee của anh có quyền sử dụng.</p><div class="field"><label>Tên hiển thị</label><input id="admin-voice-label" maxlength="80" placeholder="Giọng Nhung Pro"></div><div class="field"><label>Voice code Ibee</label><input id="admin-voice-code" maxlength="180" placeholder="Mã giọng đã copy từ Ibee"></div><button id="admin-add-voice" class="primary">Thêm giọng</button><div class="divider"></div><div id="admin-voices" class="stack"></div></div><div><h3>Gán giọng theo tài khoản</h3><p class="tiny muted status-line">Mỗi tài khoản chỉ thấy và dùng giọng được chọn ở đây.</p><div id="admin-users" class="stack"></div></div></div></section>`:''}`;
}
function renderApp(){
 $('#login-screen').hidden=true;$('#app').hidden=false;
 const nav=Object.entries(pages).map(([p,label],i)=>`<button data-page="${p}" class="${p==='media'?'active':''}">${icon(['video','pen','mic','settings'][i])}<span>${label}</span></button>`).join('');
 $('#app').innerHTML=`<aside class="sidebar"><div class="brand">${logo}<div><strong>cliplab<span class="hero-accent">.</span></strong><small>IBEE CREATOR STUDIO</small></div></div><div class="workspace"><span class="avatar">${esc(S.session.username.slice(0,2).toUpperCase())}</span><div><strong>${esc(S.session.username)}</strong><p class="tiny muted">${esc(S.session.role)}</p></div></div><p class="nav-label">CHỨC NĂNG</p><nav class="nav">${nav}</nav><div class="sidebar-bottom"><div class="free-card"><span class="pill green">IBEE API</span><h3>Giọng theo phân quyền</h3><p>Admin cấp giọng cho từng tài khoản con.</p></div></div></aside><main class="main"><header class="topbar"><div class="crumb"><strong id="breadcrumb">Tư liệu video</strong></div><div class="user-badge"><span class="pill ${S.session.role==='admin'?'purple':'green'}">${esc(S.session.role)}</span><strong>${esc(S.session.username)}</strong><button id="logout" class="small">${icon('logout')}</button></div></header><div class="content"><div id="page-media">${mediaMarkup()}</div><div id="page-script" hidden>${scriptMarkup()}</div><div id="page-voice" hidden>${voiceMarkup()}</div><div id="page-settings" hidden>${settingsMarkup()}</div></div></main>`;
}
function navigate(page){
 if(!pages[page]||S.camera.recording)return;
 S.page=page;if(page!=='media'&&S.camera.stream)closeCamera();
 for(const p of Object.keys(pages))$('#page-'+p).hidden=p!==page;
 $$('.nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 $('#breadcrumb').textContent=pages[page];window.scrollTo({top:0});
 if(page==='settings')renderSettings();
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
 if(!S.adminState||!$('#admin-users'))return;const voices=S.adminState.voices||[];
 $('#admin-voices').innerHTML=voices.length?voices.map(v=>`<div class="voice-card"><div class="row between"><div><strong>${esc(v.label)}</strong><br><code>${esc(v.code)}</code></div><button class="small danger" data-remove-pro-voice="${esc(v.code)}">Xóa</button></div></div>`).join(''):'<div class="empty">Chưa thêm giọng chuyên nghiệp.</div>';
 $('#admin-users').innerHTML=(S.adminState.users||[]).map(u=>`<div class="voice-card"><div class="row between"><strong>${esc(u.username)}</strong><span class="pill">${esc(u.role)}</span></div><div class="field"><select data-assign-user="${esc(u.username)}"><option value="">-- Chưa cấp giọng --</option>${voices.map(v=>`<option value="${esc(v.code)}" ${u.voiceCode===v.code?'selected':''}>${esc(v.label)}</option>`).join('')}</select></div></div>`).join('');
}
function closeCamera(){S.camera.close();const p=$('#camera-video');if(!p)return;p.srcObject=null;$('#open-camera').disabled=false;$('#start-record').disabled=true;$('#close-camera').hidden=true;if(!videoAsset())$('#camera-empty').hidden=false}
function bindEvents(){
 $('#app').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.page)return navigate(b.dataset.page);
  if(b.dataset.selectVideo)return selectVideo(b.dataset.selectVideo);
  if(b.dataset.deleteAsset)return busy(b,async()=>{await remove('assets',b.dataset.deleteAsset);S.assets=await all('assets');if(S.selectedVideo===b.dataset.deleteAsset)S.selectedVideo=S.assets.find(a=>a.kind==='video')?.id||null;selectVideo(S.selectedVideo)});
  if(b.dataset.removeProVoice)return busy(b,async()=>{await api('admin-remove-voice',{code:b.dataset.removeProVoice});await loadAdminState();toast('Đã xóa giọng khỏi danh sách.')});
 };
 $('#app').onchange=e=>{const el=e.target.closest('[data-assign-user]');if(!el)return;const username=el.dataset.assignUser,voiceCode=el.value;el.disabled=true;(async()=>{try{await api('admin-assign-voice',{username,voiceCode});await loadAdminState();if(username===S.session.username)S.session=await api('session');toast('Đã cập nhật giọng cho '+username)}catch(err){toast(err.message||'Không thể cập nhật giọng.',true);await loadAdminState()}finally{if(document.body.contains(el))el.disabled=false}})()};
 $('#open-camera').onclick=()=>busy($('#open-camera'),async()=>{const stream=await S.camera.open({facing:$('#camera-facing').value,portrait:$('#camera-ratio').value==='portrait',audio:$('#camera-audio').checked});const p=$('#camera-video');p.removeAttribute('src');p.srcObject=stream;p.controls=false;p.muted=true;await p.play();$('#camera-empty').hidden=true;$('#start-record').disabled=false;$('#close-camera').hidden=false});
 $('#start-record').onclick=()=>busy($('#start-record'),async()=>{$('#stop-record').hidden=false;$('#record-time').hidden=false;try{const rr=await S.camera.start(179,t=>$('#record-time').textContent='REC '+clock(t));const ext=rr.blob.type.includes('mp4')?'mp4':'webm';await ingestVideo(new File([rr.blob],`tu-lieu-${Date.now()}.${ext}`,{type:rr.blob.type}),rr.duration)}finally{$('#stop-record').hidden=true;$('#record-time').hidden=true;closeCamera()}});
 $('#stop-record').onclick=()=>S.camera.stop();$('#close-camera').onclick=()=>{closeCamera();selectVideo(S.selectedVideo)};
 $('#choose-video').onclick=()=>$('#video-file').click();$('#video-file').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)busy($('#choose-video'),()=>ingestVideo(f),'#camera-status')};
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
 $('#clear-local').onclick=()=>busy($('#clear-local'),async()=>{if(!confirm('Xóa toàn bộ video/audio lưu trên trình duyệt của tài khoản này?'))return;await clear('assets');S.assets=[];S.selectedVideo=null;S.latestAudio=null;renderVideoLibrary();selectVideo(null);$('#audio-output')?.setAttribute('hidden','')});
 if($('#admin-add-voice'))$('#admin-add-voice').onclick=()=>busy($('#admin-add-voice'),async()=>{await api('admin-add-voice',{label:$('#admin-voice-label').value,code:$('#admin-voice-code').value});$('#admin-voice-label').value='';$('#admin-voice-code').value='';await loadAdminState();toast('Đã thêm giọng Ibee chuyên nghiệp.')});
 $('#logout').onclick=()=>busy($('#logout'),async()=>{closeCamera();await api('logout',{});releaseUrls();S.session=null;$('#app').innerHTML='';loginScreen()});
}
async function boot(){
 S.session=await api('session');await initDB(S.session.username);S.assets=await all('assets');S.selectedVideo=S.assets.find(a=>a.kind==='video')?.id||null;S.page='media';
 renderApp();bindEvents();
 try{const d=JSON.parse(localStorage.getItem(draftKey())||'{}');$('#script-prompt').value=d.prompt||'';$('#script-editor').value=d.script||'';$('#voice-text').value=d.voice||'';$('#analysis-brief').value=d.brief||''}catch{}
 if(!S.session.providers.deepseek&&S.session.providers.openai)$('#text-provider').value='openai';
 renderVideoLibrary();selectVideo(S.selectedVideo);renderSettings();updateCounts();
 const latest=S.assets.filter(a=>a.kind==='audio').sort((a,b)=>b.createdAt-a.createdAt)[0];if(latest)showAudio(latest);
}
loginScreen();
boot().catch(e=>{S.session=null;if(e.status!==401){loginScreen();$('#login-error').textContent=e.message}});
window.addEventListener('beforeunload',e=>{if(S.camera.recording||S.progress.size){e.preventDefault();e.returnValue=''}});
