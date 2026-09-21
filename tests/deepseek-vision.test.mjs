import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, models } from '../lib/providers.mjs';

process.env.APP_PASSWORD='test-only-password-123456';
process.env.SESSION_SECRET='test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_USERS_JSON='{}';
process.env.UPSTASH_REDIS_REST_URL='https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN='redis-test-token';
process.env.DEEPSEEK_API_KEY='deepseek-test-key';
process.env.DEEPSEEK_VISION_MODEL='deepseek-flash';

const originalFetch=global.fetch;
const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64');
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});

test.after(()=>{global.fetch=originalFetch});

test('DeepSeek Vision receives scene frames as image_url blocks and returns JSON analysis',async()=>{
  const calls=[];
  global.fetch=async(url,options={})=>{
    const href=String(url);calls.push({href,options});
    if(href==='https://redis.test/'||href==='https://redis.test'){
      const args=JSON.parse(options.body);
      if(args[0]==='EVAL')return json({result:1});
      throw new Error('Unexpected Redis command '+JSON.stringify(args));
    }
    if(href==='https://api.deepseek.com/chat/completions'){
      const body=JSON.parse(options.body);
      assert.equal(options.headers.Authorization,'Bearer deepseek-test-key');
      assert.equal(body.model,'deepseek-flash');
      assert.deepEqual(body.response_format,{type:'json_object'});
      assert.deepEqual(body.thinking,{type:'disabled'});
      const user=body.messages.find(x=>x.role==='user');
      assert.ok(Array.isArray(user.content));
      const images=user.content.filter(x=>x.type==='image_url');
      assert.equal(images.length,2);
      assert.match(images[0].image_url.url,/^data:image\/jpeg;base64,/);
      assert.equal(images[0].image_url.detail,'low');
      return json({
        choices:[{finish_reason:'stop',message:{content:JSON.stringify({
          summary:'Hai cảnh khác nhau',
          hook:'Mở đầu ngắn',
          scenes:[
            {time:'00:00',visual:'Cảnh đầu',suggestion:'Giữ cảnh'},
            {time:'00:05',visual:'Cảnh sau',suggestion:'Chuyển cảnh'}
          ],
          script:'Lời dẫn thử nghiệm.',
          warnings:['Không có audio.']
        })}}],
        usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50}
      });
    }
    throw new Error('Unexpected URL '+href);
  };

  const out=await analyze('user01',{
    consent:true,
    duration:10,
    brief:'Phân tích video',
    mode:'scene_frames',
    frames:[
      {time:0.01,data:jpeg,sceneScore:1},
      {time:5.2,data:jpeg,sceneScore:.4}
    ]
  });
  assert.equal(out.model,'deepseek-flash');
  assert.equal(out.mode,'scene_frames');
  assert.equal(out.frameCount,2);
  assert.equal(out.scenes.length,2);
  assert.equal(models().deepseekVision,'deepseek-flash');
  assert.equal(calls.filter(x=>x.href==='https://api.deepseek.com/chat/completions').length,1);
});

test('DeepSeek Vision retries one transient 503',async()=>{
  let attempts=0;
  global.fetch=async(url,options={})=>{
    const href=String(url);
    if(href==='https://redis.test/'||href==='https://redis.test'){
      const args=JSON.parse(options.body);
      if(args[0]==='EVAL')return json({result:1});
      throw new Error('Unexpected Redis command '+JSON.stringify(args));
    }
    if(href==='https://api.deepseek.com/chat/completions'){
      attempts++;
      if(attempts===1)return json({error:{message:'busy'}},503,{'retry-after':'0.001'});
      return json({choices:[{message:{content:JSON.stringify({
        summary:'OK',hook:'H',scenes:[{time:'00:00',visual:'V',suggestion:'S'}],script:'T',warnings:[]
      })}}],usage:{}});
    }
    throw new Error('Unexpected URL '+href);
  };
  const out=await analyze('user01',{consent:true,duration:2,brief:'',mode:'scene_frames',frames:[{time:.01,data:jpeg}]});
  assert.equal(out.summary,'OK');
  assert.equal(attempts,2);
});
