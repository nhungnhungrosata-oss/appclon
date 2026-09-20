import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, users, sessionCookie, authenticate, checkOrigin } from '../lib/core.mjs';
import { seedUsers } from '../lib/seed-users.mjs';
import { quota } from '../lib/store.mjs';

process.env.SESSION_SECRET='test-only-secret-DO-NOT-USE-IN-PRODUCTION-123456';
process.env.APP_PASSWORD='test-only-password-123456';
process.env.APP_USERS_JSON='{}';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

test('ten child accounts are seeded as scrypt hashes',()=>{
  assert.equal(Object.keys(seedUsers).length,10);
  for(let i=1;i<=10;i++){
    const name='user'+String(i).padStart(2,'0');
    assert.match(seedUsers[name].passwordHash,/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.equal(seedUsers[name].role,'member');
  }
});
test('users include admin and ten children',()=>{
  const all=users(); assert.equal(all.admin.role,'admin'); assert.equal(Object.keys(all).length,11);
});
test('password hashing and session invalidation work',()=>{
  const h=hashPassword('secret-123456'); assert.ok(verifyPassword('secret-123456',h)); assert.equal(verifyPassword('wrong',h),false);
  const cookie=sessionCookie('admin',{password:process.env.APP_PASSWORD},true); assert.equal(authenticate({headers:{cookie}}).username,'admin');
});
test('same-origin protection rejects foreign origin',()=>{
  checkOrigin({headers:{host:'example.test',origin:'https://example.test','sec-fetch-site':'same-origin'}});
  assert.throws(()=>checkOrigin({headers:{host:'example.test',origin:'https://evil.test'}}),{status:403});
});
test('multi-user paid actions fail closed without Redis',async()=>{
  await assert.rejects(()=>quota('user01','tts'),{status:503});
});
