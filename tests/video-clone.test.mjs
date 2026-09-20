import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeCloneChunk, syncCreateUpload, syncRegisterAsset, syncSubmitGeneration, syncGenerationStatus, syncCleanupAssets } from '../lib/video-clone.mjs';

process.env.APP_PASSWORD='test-only-password-123456';
process.env.SESSION_SECRET='test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_USERS_JSON='{}';
process.env.UPSTASH_REDIS_REST_URL='https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN='redis-test-token';
process.env.OPENAI_API_KEY='openai-test';
process.env.SYNC_API_KEY='sync-test';
process.env.SYNC_LIPSYNC_MODEL='lipsync-2';

const originalFetch=global.fetch;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

function wavBase64(){
 const b=Buffer.alloc(200);b.write('RIFF',0);b.write('WAVE',8);return b.toString('base64');
}

test.after(()=>{global.fetch=originalFetch});

test('video clone provider flow validates transcription and Sync contracts',async()=>{
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
  if(href==='https://api.sync.so/v2/assets/upload'){
   assert.equal(options.headers['x-api-key'],'sync-test');
   return json({uploadUrl:'https://uploads.sync.so/presigned/test',url:'https://assets.sync.so/uploads/test/source.mp4',expiresIn:3600},201);
  }
  if(href==='https://api.sync.so/v2/assets'){
   const body=JSON.parse(options.body);
   assert.equal(body.type,'VIDEO');
   return json({id:'asset_video_123',type:'VIDEO'},201);
  }
  if(href==='https://api.sync.so/v2/generate'){
   const body=JSON.parse(options.body);
   assert.equal(body.model,'lipsync-2');
   assert.equal(body.input[0].assetId,'asset_video_123');
   assert.equal(body.input[1].assetId,'asset_audio_123');
   assert.equal(body.options.sync_mode,'cut_off');
   return json({id:'generation_123',status:'PENDING'},201);
  }
  if(href==='https://api.sync.so/v2/generate/generation_123')return json({id:'generation_123',status:'COMPLETED',outputUrl:'https://cdn.sync.so/result.mp4'});
  if(href==='https://api.sync.so/v2/assets/asset_video_123'&&options.method==='DELETE')return new Response('',{status:204});
  throw new Error('Unexpected URL '+href);
 };

 const tr=await transcribeCloneChunk('user01',{audioBase64:wavBase64(),offset:10,duration:5,consent:true});
 assert.equal(tr.segments[0].start,10.2);
 assert.equal(tr.segments[0].end,12.4);
 assert.equal(tr.segments[0].text,'Xin chào mọi người');

 const up=await syncCreateUpload('user01',{fileName:'source.mp4',contentType:'video/mp4',size:1000,consent:true});
 assert.match(up.uploadUrl,/uploads\.sync\.so/);
 const asset=await syncRegisterAsset('user01',{url:up.url,type:'VIDEO',name:'source.mp4',consent:true});
 assert.equal(asset.id,'asset_video_123');
 const gen=await syncSubmitGeneration('user01',{videoAssetId:'asset_video_123',audioAssetId:'asset_audio_123',consent:true});
 assert.equal(gen.id,'generation_123');
 const status=await syncGenerationStatus('user01',{id:gen.id});
 assert.equal(status.ready,true);
 assert.equal(status.outputUrl,'https://cdn.sync.so/result.mp4');
 const cleanup=await syncCleanupAssets('user01',{assetIds:['asset_video_123']});
 assert.equal(cleanup.results[0].deleted,true);
 assert.ok(calls.some(x=>x.href==='https://api.openai.com/v1/audio/transcriptions'));
});
