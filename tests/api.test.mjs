import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../api/index.js';

process.env.APP_PASSWORD='test-only-password-123456';
process.env.SESSION_SECRET='test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_USERS_JSON='{}';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const server=createServer(handler); await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`; let cookie='';
async function req(action,body,origin=base){
  return fetch(`${base}/api/index?action=${action}`,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
test.after(()=>new Promise(r=>server.close(r)));

test('health is public and session is protected',async()=>{
  const h=await req('health'); assert.equal(h.status,200); assert.deepEqual(await h.json(),{ok:true,service:'cliplab'});
  assert.equal((await req('session')).status,401);
});
test('admin login exposes Vbee provider state without secrets',async()=>{
  const r=await req('login',{username:'admin',password:process.env.APP_PASSWORD}); assert.equal(r.status,200); cookie=r.headers.get('set-cookie').split(';')[0];
  const d=await (await req('session')).json(); assert.equal(d.username,'admin'); assert.equal(d.role,'admin'); assert.ok('vbee' in d.providers); assert.ok('sync' in d.providers); assert.ok(!('fish' in d.providers)); assert.ok(!('lipSync' in d));
  assert.ok(!JSON.stringify(d).includes(process.env.SESSION_SECRET));
});
test('admin state lists ten children plus admin',async()=>{
  const r=await req('admin-state',{}); assert.equal(r.status,200); const d=await r.json(); assert.equal(d.users.length,11); assert.equal(d.redis,false);
});
test('adding a voice fails closed until shared Redis is configured',async()=>{
  const r=await req('admin-add-voice',{label:'Giọng Pro',code:'professional-voice-code'}); assert.equal(r.status,503); assert.equal((await r.json()).code,'REDIS_REQUIRED');
});
test('Fish and lip-sync routes no longer exist',async()=>{
  for(const action of ['tts','lip-submit','lip-status']) assert.equal((await req(action,{})).status,404);
});
test('cross-origin login is rejected',async()=>{
  cookie=''; assert.equal((await req('login',{username:'admin',password:process.env.APP_PASSWORD},'https://evil.test')).status,403);
});
