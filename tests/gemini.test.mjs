import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, models } from '../lib/providers.mjs';

process.env.APP_PASSWORD='test-only-password-123456';
process.env.SESSION_SECRET='test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_USERS_JSON='{}';
process.env.UPSTASH_REDIS_REST_URL='https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN='redis-test-token';
process.env.GOOGLE_API_KEY='google-test-key';
process.env.GOOGLE_MODEL='gemini-retired-test';

const originalFetch=global.fetch;
const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test.after(()=>{global.fetch=originalFetch});

test('Gemini analysis falls back from configured 404 model to stable Flash-Lite',async()=>{
  const calls=[];
  global.fetch=async(url,options={})=>{
    const href=String(url);calls.push({href,options});
    if(href==='https://redis.test/'||href==='https://redis.test'){
      const args=JSON.parse(options.body);
      if(args[0]==='EVAL')return json({result:1});
      throw new Error('Unexpected Redis command '+JSON.stringify(args));
    }
    if(href.endsWith('/v1beta/models/gemini-retired-test:generateContent')) return json({error:{message:'not found'}},404);
    if(href.endsWith('/v1beta/models/gemini-3.5-flash-lite:generateContent')){
      const body=JSON.parse(options.body);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'minimal');
      assert.ok(!('temperature' in body.generationConfig));
      return json({
        candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({
          summary:'Video thử nghiệm',
          hook:'Mở đầu',
          scenes:[{time:'00:00',visual:'Khung hình thử',suggestion:'Giữ cảnh'}],
          script:'Xin chào.',
          warnings:[]
        })}]}}],
        usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}
      });
    }
    throw new Error('Unexpected URL '+href);
  };

  const out=await analyze('user01',{
    consent:true,
    duration:3,
    brief:'',
    mode:'frames',
    frames:[{time:0,data:jpeg}]
  });
  assert.equal(out.model,'gemini-3.5-flash-lite');
  assert.equal(out.summary,'Video thử nghiệm');
  assert.equal(calls.filter(x=>x.href.includes(':generateContent')).length,2);
  assert.equal(models().google,'gemini-retired-test');
});


test('Gemini analysis retries 503 then falls back to another stable model',async()=>{
  process.env.GOOGLE_MODEL='gemini-3.5-flash-lite';
  const calls=[];
  let liteCalls=0;
  global.fetch=async(url,options={})=>{
    const href=String(url);calls.push({href,options});
    if(href==='https://redis.test/'||href==='https://redis.test'){
      const args=JSON.parse(options.body);
      if(args[0]==='EVAL')return json({result:1});
      throw new Error('Unexpected Redis command '+JSON.stringify(args));
    }
    if(href.endsWith('/v1beta/models/gemini-3.5-flash-lite:generateContent')){
      liteCalls++;
      return new Response(JSON.stringify({error:{message:'UNAVAILABLE'}}),{
        status:503,
        headers:{'content-type':'application/json','retry-after':'0.001'}
      });
    }
    if(href.endsWith('/v1beta/models/gemini-3.6-flash:generateContent')){
      const body=JSON.parse(options.body);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'low');
      return json({
        candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({
          summary:'Fallback thành công',
          hook:'Hook',
          scenes:[{time:'00:00',visual:'Khung hình',suggestion:'Giữ cảnh'}],
          script:'Xin chào.',
          warnings:[]
        })}]}}],
        usageMetadata:{promptTokenCount:12,candidatesTokenCount:8}
      });
    }
    throw new Error('Unexpected URL '+href);
  };

  const out=await analyze('user01',{
    consent:true,
    duration:3,
    brief:'',
    mode:'frames',
    frames:[{time:0,data:jpeg}]
  });
  assert.equal(liteCalls,2);
  assert.equal(out.model,'gemini-3.6-flash');
  assert.equal(out.summary,'Fallback thành công');
  assert.equal(calls.filter(x=>x.href.includes(':generateContent')).length,3);
});
