import { fail, sha, users } from './core.mjs';
const memory = new Map();
export function hasRedis() { return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN); }
function sweep() { const now = Date.now(); for (const [k, v] of memory) if (v.exp <= now) memory.delete(k); if (memory.size > 15000) fail(503, 'Bộ giới hạn đầy; cần Redis.'); }
async function command(args) {
  const url = new URL(process.env.UPSTASH_REDIS_REST_URL);
  if (url.protocol !== 'https:') fail(503, 'Redis REST URL phải là HTTPS.');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(7000), redirect: 'error' });
  if (!r.ok) fail(503, 'Không kết nối Redis; tạm khóa tác vụ để bảo vệ chi phí.');
  const d = await r.json(); if (d.error) fail(503, 'Redis từ chối yêu cầu.'); return d.result;
}
export async function get(k) { if (hasRedis()) { const value = await command(['GET', `cliplab:${k}`]); return value ? JSON.parse(value) : null; } sweep(); return memory.get(k)?.value ?? null; }
export async function set(k, value, seconds = 86400, onlyNew = false) { if (hasRedis()) return await command(['SET', `cliplab:${k}`, JSON.stringify(value), 'EX', seconds, ...(onlyNew ? ['NX'] : [])]) === 'OK'; sweep(); if (onlyNew && memory.has(k)) return false; memory.set(k, { value, exp: Date.now() + seconds * 1000 }); return true; }
export async function limit(k, maximum, seconds) {
  let count;
  if (hasRedis()) count = await command(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n", 1, `cliplab:${k}`, seconds]);
  else { sweep(); const item = memory.get(k); count = (item?.value || 0) + 1; memory.set(k, { value: count, exp: item?.exp || Date.now() + seconds * 1000 }); }
  if (count > maximum) fail(429, 'Hết hạn mức tác vụ. Vui lòng thử lại sau.', 'QUOTA_EXCEEDED'); return maximum - count;
}
export async function quota(user, action) {
  if (Object.keys(users()).length > 1 && !hasRedis()) fail(503, 'Nhiều thành viên yêu cầu Upstash Redis để giới hạn dùng chung giữa các server.');
  const defaults = { text: 30, analysis: 15, tts: 30, upload: 40 };
  const n = Number(process.env[`DAILY_${action.toUpperCase()}_LIMIT`] || defaults[action] || 30);
  const global = Number(process.env[`GLOBAL_${action.toUpperCase()}_LIMIT`] || n * 10);
  if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(global) || global < 0) fail(503, 'Hạn mức cấu hình không hợp lệ.');
  const day = new Date().toISOString().slice(0, 10);
  await limit(`global:${day}:${action}`, global, 172800);
  return limit(`quota:${day}:${sha(user).slice(0, 24)}:${action}`, n, 172800);
}