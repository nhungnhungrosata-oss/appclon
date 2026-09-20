import { fail, key, number, consent } from './core.mjs';
import { quota } from './store.mjs';

const OPENAI_TRANSCRIBE='https://api.openai.com/v1/audio/transcriptions';

function safeMessage(data,fallback){
  const value=data?.error?.message||data?.error||data?.message||fallback;
  return String(value||fallback).replace(/[\r\n]+/g,' ').slice(0,300);
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
