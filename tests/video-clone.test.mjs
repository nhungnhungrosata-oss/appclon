import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeCloneChunk } from '../lib/video-clone.mjs';

process.env.APP_PASSWORD='test-only-password-123456';
process.env.SESSION_SECRET='test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_USERS_JSON='{}';
process.env.UPSTASH_REDIS_REST_URL='https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN='redis-test-token';
process.env.OPENAI_API_KEY='openai-test';

const originalFetch=global.fetch;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

function wavBase64(){
 const b=Buffer.alloc(200);b.write('RIFF',0);b.write('WAVE',8);return b.toString('base64');
}

test.after(()=>{global.fetch=originalFetch});

test('video clone transcription keeps source timestamps and does not require lip-sync provider',async()=>{
 const calls=[];
 global.fetch=async(url,options={})=>{
  const href=String(url);calls.push({href,options});
  if(href==='https://redis.test/'||href==='https://redis.test'){
   const args=JSON.parse(options.body);
   if(args[0]==='EVAL')return json({result:1});
   throw new Error('Unexpected Redis command '+JSON.stringify(args));
  }
  if(href==='https://api.openai.com/v1/audio/transcriptions'){
   assert.equal(options.method,'POST');
   assert.equal(options.headers.Authorization,'Bearer openai-test');
   assert.ok(options.body instanceof FormData);
   return json({language:'vi',text:'Xin chào mọi người',segments:[{start:0.2,end:2.4,text:'Xin chào mọi người'}],words:[{start:0.2,end:0.7,word:'Xin'}]});
  }
  throw new Error('Unexpected URL '+href);
 };

 const tr=await transcribeCloneChunk('user01',{audioBase64:wavBase64(),offset:10,duration:5,consent:true});
 assert.equal(tr.segments[0].start,10.2);
 assert.equal(tr.segments[0].end,12.4);
 assert.equal(tr.segments[0].text,'Xin chào mọi người');
 assert.ok(calls.some(x=>x.href==='https://api.openai.com/v1/audio/transcriptions'));
 assert.ok(calls.every(x=>!x.href.includes('sync.so')));
});
