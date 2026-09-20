import { fail, key, text, number, consent } from './core.mjs';
import { quota } from './store.mjs';

const OPENAI_TRANSCRIBE='https://api.openai.com/v1/audio/transcriptions';
const SYNC_BASE='https://api.sync.so';
const ALLOWED_SYNC_MODELS=new Set(['lipsync-2','lipsync-2-pro','sync-3']);

function safeMessage(data,fallback){
  const value=data?.error?.message||data?.error||data?.message||fallback;
  return String(value||fallback).replace(/[\r\n]+/g,' ').slice(0,300);
}
async function syncRequest(path,options={},timeout=20000){
  const method=(options.method||'GET').toUpperCase();
  const attempts=['GET','DELETE'].includes(method)?3:1;
  let last;
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const r=await fetch(SYNC_BASE+path,{
        ...options,
        headers:{'x-api-key':key('SYNC_API_KEY'),Accept:'application/json',...(options.headers||{})},
        redirect:'error',
        signal:AbortSignal.timeout(timeout)
      });
      const raw=await r.text(); let data={};
      if(raw){try{data=JSON.parse(raw)}catch{fail(502,`Dịch vụ lip-sync trả dữ liệu không hợp lệ (HTTP ${r.status}).`,'SYNC_BAD_RESPONSE')}}
      if(r.ok)return data;
      if(attempt+1<attempts&&(r.status===429||r.status>=500)){last={status:r.status,data};await new Promise(x=>setTimeout(x,500*(attempt+1)));continue}
      const code=r.status===429?429:502;
      fail(code,`Lip-sync: ${safeMessage(data,'nhà cung cấp từ chối yêu cầu')} (HTTP ${r.status}).`,'SYNC_API_ERROR');
    }catch(e){
      if(e?.status)throw e;
      last=e;
      if(attempt+1<attempts){await new Promise(x=>setTimeout(x,500*(attempt+1)));continue}
      if(e?.name==='TimeoutError'||e?.name==='AbortError')fail(504,'Dịch vụ lip-sync phản hồi quá chậm.','SYNC_TIMEOUT');
      fail(502,'Không kết nối được dịch vụ lip-sync.','SYNC_NETWORK_ERROR');
    }
  }
  throw last;
}

export async function transcribeCloneChunk(user,b){
  consent(b.consent); key('OPENAI_API_KEY');
  const offset=number(b.offset??0,'Mốc bắt đầu',0,180);
  const duration=number(b.duration,'Thời lượng chunk',0.2,50);
  if(typeof b.audioBase64!=='string'||b.audioBase64.length<100||b.audioBase64.length>3_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.audioBase64)) fail(400,'Audio chunk không hợp lệ.');
  const bytes=Buffer.from(b.audioBase64,'base64');
  if(bytes.length<44||bytes.length>2_200_000||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE') fail(400,'Audio chunk phải là WAV hợp lệ dưới 2,2 MB.');
  await quota(user,'clone_transcribe');

  const form=new FormData();
  form.append('file',new Blob([bytes],{type:'audio/wav'}),`clip-${Math.round(offset*1000)}.wav`);
  form.append('model',process.env.OPENAI_TRANSCRIBE_MODEL||'whisper-1');
  form.append('language','vi');
  form.append('response_format','verbose_json');
  form.append('temperature','0');
  form.append('timestamp_granularities[]','segment');
  form.append('timestamp_granularities[]','word');

  let r;
  try{
    r=await fetch(OPENAI_TRANSCRIBE,{method:'POST',headers:{Authorization:`Bearer ${key('OPENAI_API_KEY')}`},body:form,signal:AbortSignal.timeout(45000),redirect:'error'});
  }catch(e){
    if(e?.name==='TimeoutError'||e?.name==='AbortError')fail(504,'Nhận dạng lời thoại quá chậm. Không tự gửi lại để tránh tính phí lặp.','TRANSCRIBE_TIMEOUT');
    fail(502,'Không kết nối được dịch vụ nhận dạng lời thoại.','TRANSCRIBE_NETWORK_ERROR');
  }
  let data;try{data=await r.json()}catch{fail(502,'Dịch vụ nhận dạng trả dữ liệu không hợp lệ.','TRANSCRIBE_BAD_RESPONSE')}
  if(!r.ok) fail(r.status===429?429:502,`Nhận dạng lời thoại: ${safeMessage(data,'yêu cầu thất bại')} (HTTP ${r.status}).`,'TRANSCRIBE_API_ERROR');

  const segments=(Array.isArray(data.segments)?data.segments:[]).map((s,i)=>({
    id:`${Math.round(offset*1000)}-${i}`,
    start:Number((offset+Number(s.start||0)).toFixed(3)),
    end:Number((offset+Number(s.end||0)).toFixed(3)),
    text:String(s.text||'').trim()
  })).filter(s=>s.text&&s.end>s.start&&s.start<=offset+duration+1);
  const words=(Array.isArray(data.words)?data.words:[]).map(w=>({
    start:Number((offset+Number(w.start||0)).toFixed(3)),
    end:Number((offset+Number(w.end||0)).toFixed(3)),
    word:String(w.word||'').trim()
  })).filter(w=>w.word&&w.end>w.start);
  return {segments,words,text:String(data.text||'').trim(),language:data.language||'vi'};
}

export async function syncCreateUpload(user,b){
  consent(b.consent); key('SYNC_API_KEY');
  const fileName=text(b.fileName,'Tên file',160);
  const contentType=text(b.contentType,'Content-Type',80);
  const size=number(b.size,'Dung lượng file',1,100*1024*1024);
  const allowed=new Set(['video/mp4','video/webm','video/quicktime','audio/wav']);
  if(!allowed.has(contentType))fail(415,'Định dạng upload lip-sync không hỗ trợ.');
  await quota(user,'clone_upload');
  const data=await syncRequest('/v2/assets/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileName,contentType,size})},20000);
  if(typeof data.uploadUrl!=='string'||typeof data.url!=='string')fail(502,'Lip-sync không trả upload URL hợp lệ.','SYNC_BAD_RESPONSE');
  const upload=new URL(data.uploadUrl),canonical=new URL(data.url);
  if(upload.protocol!=='https:'||canonical.protocol!=='https:'||canonical.hostname!=='assets.sync.so')fail(502,'Lip-sync trả URL upload không an toàn.','SYNC_BAD_RESPONSE');
  return {uploadUrl:data.uploadUrl,url:data.url,expiresIn:Number(data.expiresIn||0)};
}

export async function syncRegisterAsset(user,b){
  consent(b.consent); key('SYNC_API_KEY');
  const url=text(b.url,'Asset URL',1000);
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.hostname!=='assets.sync.so')fail(400,'Asset URL không thuộc Sync.');
  const type=b.type;
  if(!['VIDEO','AUDIO'].includes(type))fail(400,'Loại asset không hợp lệ.');
  const name=text(b.name||'cliplab-media','Tên asset',160);
  const data=await syncRequest('/v2/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,type,name})},20000);
  if(typeof data.id!=='string'||data.id.length<8)fail(502,'Lip-sync không trả asset id hợp lệ.','SYNC_BAD_RESPONSE');
  return {id:data.id,type:data.type||type,durationSeconds:data.durationSeconds||null};
}

export async function syncSubmitGeneration(user,b){
  consent(b.consent); key('SYNC_API_KEY');
  const videoAssetId=text(b.videoAssetId,'Video asset',120);
  const audioAssetId=text(b.audioAssetId,'Audio asset',120);
  if(!/^[a-zA-Z0-9_-]{8,120}$/.test(videoAssetId)||!/^[a-zA-Z0-9_-]{8,120}$/.test(audioAssetId))fail(400,'Asset id không hợp lệ.');
  const model=process.env.SYNC_LIPSYNC_MODEL||'lipsync-2';
  if(!ALLOWED_SYNC_MODELS.has(model))fail(503,'SYNC_LIPSYNC_MODEL không hợp lệ.');
  await quota(user,'clone_video');
  const payload={model,input:[{type:'video',assetId:videoAssetId},{type:'audio',assetId:audioAssetId}],options:{sync_mode:'cut_off'}};
  const data=await syncRequest('/v2/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},30000);
  const id=data.id||data.generationId;
  if(typeof id!=='string'||id.length<8)fail(502,'Lip-sync không trả generation id hợp lệ.','SYNC_BAD_RESPONSE');
  console.info(JSON.stringify({event:'video_clone_submitted',model,generationId:id}));
  return {id,model,status:data.status||'PENDING'};
}

export async function syncGenerationStatus(user,b){
  key('SYNC_API_KEY');
  const id=text(b.id,'Generation id',120);
  if(!/^[a-zA-Z0-9_-]{8,120}$/.test(id))fail(400,'Generation id không hợp lệ.');
  const data=await syncRequest(`/v2/generate/${encodeURIComponent(id)}`,{method:'GET'},15000);
  const status=String(data.status||'PENDING').toUpperCase();
  const outputUrl=data.outputUrl||data.output?.url||'';
  if(outputUrl){let u;try{u=new URL(outputUrl)}catch{fail(502,'Lip-sync trả video URL không hợp lệ.','SYNC_BAD_RESPONSE')}if(u.protocol!=='https:')fail(502,'Lip-sync trả video URL không an toàn.','SYNC_BAD_RESPONSE')}
  return {id,status,ready:['COMPLETED','SUCCESS','DONE'].includes(status)&&!!outputUrl,failed:['FAILED','ERROR','CANCELED'].includes(status),outputUrl:outputUrl||undefined,error:safeMessage(data,'')};
}

export async function syncCleanupAssets(user,b){
  key('SYNC_API_KEY');
  if(!Array.isArray(b.assetIds)||b.assetIds.length<1||b.assetIds.length>4)fail(400,'Danh sách asset cleanup không hợp lệ.');
  const results=[];
  for(const raw of b.assetIds){
    const id=text(raw,'Asset id',120);
    if(!/^[a-zA-Z0-9_-]{8,120}$/.test(id))continue;
    try{await syncRequest(`/v2/assets/${encodeURIComponent(id)}`,{method:'DELETE'},12000);results.push({id,deleted:true})}
    catch(e){results.push({id,deleted:false})}
  }
  return {results};
}
