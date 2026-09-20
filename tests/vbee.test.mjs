import test from 'node:test';
import assert from 'node:assert/strict';
import { vbeeSubmit, vbeeStatus } from '../lib/providers.mjs';

process.env.APP_PASSWORD='test-only-password-123456';
process.env.SESSION_SECRET='test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_USERS_JSON='{}';
process.env.UPSTASH_REDIS_REST_URL='https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN='redis-test-token';
process.env.VBEE_APP_ID='app-test-id';
process.env.VBEE_TOKEN='vbee-test-token';

const originalFetch=global.fetch;

function json(data,status=200,headers={}) {
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
}

test.after(()=>{global.fetch=originalFetch;});

test('Vbee flow mirrors working app: submit -> requestId -> COMPLETED -> audioLink',async()=>{
  const calls=[];
  global.fetch=async(url,options={})=>{
    const href=String(url); calls.push({href,options});
    if(href==='https://redis.test'){
      const args=JSON.parse(options.body);
      if(args[0]==='GET' && args[1]==='cliplab:voice-assignment:user01') return json({result:JSON.stringify('voice-professional-1')});
      if(args[0]==='GET' && args[1]==='cliplab:vbee-professional-voices') return json({result:JSON.stringify([{code:'voice-professional-1',label:'Giọng Pro'}])});
      if(args[0]==='EVAL') return json({result:1});
      throw new Error('Unexpected Redis command '+JSON.stringify(args));
    }
    if(href==='https://api.vbee.vn/v1/tts'){
      assert.equal(options.method,'POST');
      assert.equal(options.headers['App-Id'],'app-test-id');
      assert.equal(options.headers.Authorization,'Bearer vbee-test-token');
      const body=JSON.parse(options.body);
      assert.equal(body.text,'Xin chào từ ClipLab');
      assert.equal(body.voiceCode,'voice-professional-1');
      assert.equal(body.mode,'async');
      assert.equal(body.outputFormat,'mp3');
      assert.equal(body.bitrate,128);
      assert.equal(body.speed,1);
      assert.equal(body.webhookUrl,'https://app.example/api/index?action=vbee-callback');
      return json({requestId:'req-12345678'});
    }
    if(href==='https://api.vbee.vn/v1/tts/requests/req-12345678'){
      assert.equal(options.method,'GET');
      assert.equal(options.headers['App-Id'],'app-test-id');
      return json({status:'COMPLETED',audioLink:'https://cdn.example.test/audio.mp3'});
    }
    throw new Error('Unexpected URL '+href);
  };

  const submitted=await vbeeSubmit('user01',{consent:true,text:'Xin chào từ ClipLab',speed:1},'https://app.example');
  assert.equal(submitted.requestId,'req-12345678');
  assert.equal(submitted.voice.code,'voice-professional-1');
  const state=await vbeeStatus('user01',submitted.token);
  assert.equal(state.ready,true);
  assert.equal(state.failed,false);
  assert.equal(state.status,'COMPLETED');
  assert.equal(state.audioLink,'https://cdn.example.test/audio.mp3');
  assert.equal(calls.some(x=>x.href==='https://api.vbee.vn/v1/tts'),true);
});
