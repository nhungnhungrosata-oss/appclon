import { createHmac, createHash, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';

export class AppError extends Error {
  constructor(status, message, code = 'APP_ERROR') { super(message); this.status = status; this.code = code; }
}
export const fail = (status, message, code) => { throw new AppError(status, message, code); };
export const sha = s => createHash('sha256').update(String(s)).digest('hex');
export const uid = () => randomBytes(16).toString('hex');
export function safeEqual(a, b) { const aa = Buffer.from(String(a)), bb = Buffer.from(String(b)); return aa.length === bb.length && timingSafeEqual(aa, bb); }
export function secret() { const value = process.env.SESSION_SECRET || ''; if (value.length < 32) fail(503, 'Cần SESSION_SECRET tối thiểu 32 ký tự trên Vercel.', 'SETUP_REQUIRED'); return value; }
export function seal(type, payload, seconds = 3600) { const body = Buffer.from(JSON.stringify({ ...payload, type, exp: Math.floor(Date.now() / 1000) + seconds })).toString('base64url'); return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`; }
export function unseal(token, type, user) {
  if (typeof token !== 'string' || token.length > 12000) fail(401, 'Phiên hoặc mã truy cập không hợp lệ.');
  const parts = token.split('.');
  if (parts.length !== 2 || !safeEqual(parts[1], createHmac('sha256', secret()).update(parts[0]).digest('base64url'))) fail(401, 'Mã truy cập không hợp lệ.');
  let data; try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { fail(401, 'Mã truy cập bị hỏng.'); }
  if (data.type !== type || data.exp <= Date.now() / 1000 || (user && data.user !== user)) fail(401, 'Mã hết hạn hoặc không thuộc tài khoản này.'); return data;
}
export function hashPassword(password, salt = randomBytes(16).toString('hex')) { return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function verifyPassword(password, hash) { if (typeof hash !== 'string' || !/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/.test(hash)) return false; const [, salt, expected] = hash.split(':'); return safeEqual(scryptSync(password, salt, 64).toString('hex'), expected); }
export function users() {
  let extra = {}; try { extra = JSON.parse(process.env.APP_USERS_JSON || '{}'); } catch { fail(503, 'APP_USERS_JSON không phải JSON hợp lệ.'); }
  if (!extra || Array.isArray(extra) || typeof extra !== 'object') fail(503, 'APP_USERS_JSON phải là một object.');
  for (const [name, record] of Object.entries(extra)) if (!/^[a-zA-Z0-9_-]{1,50}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name) || !record || typeof record !== 'object' || !/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/.test(record.passwordHash || '')) fail(503, 'APP_USERS_JSON: invalid username or passwordHash; use npm run user.');
  const map = Object.assign(Object.create(null), extra); if (process.env.APP_PASSWORD) { if (process.env.APP_PASSWORD.length < 12) fail(503, 'APP_PASSWORD cần tối thiểu 12 ký tự.'); map.admin = { role: 'admin', password: process.env.APP_PASSWORD }; } return map;
}
export function authenticate(req) {
  const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('cliplab_session='))?.slice(16);
  if (!raw) fail(401, 'Vui lòng đăng nhập.', 'UNAUTHENTICATED');
  const session = unseal(raw, 'session'); const user = users()[session.user];
  if (!user || session.rev !== sha(user.passwordHash || user.password)) fail(401, 'Phiên đăng nhập đã thay đổi.');
  return { username: session.user, role: user.role || 'member' };
}
export function sessionCookie(username, record, secure) { return `cliplab_session=${seal('session', { user: username, rev: sha(record.passwordHash || record.password) }, 43200)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure ? '; Secure' : ''}`; }
export function checkOrigin(req) {
  const origin = req.headers.origin, host = req.headers.host; if (!origin || origin === 'null' || !host) fail(403, 'Yêu cầu không cùng nguồn.');
  let url; try { url = new URL(origin); } catch { fail(403, 'Origin không hợp lệ.'); }
  if (url.host !== host || !['http:', 'https:'].includes(url.protocol)) fail(403, 'Origin không khớp.');
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) fail(403, 'Không chấp nhận yêu cầu chéo trang.');
}
export async function readBody(req, limit = 3500000) {
  const declared = Number(req.headers['content-length'] || 0); if (declared > limit) fail(413, 'Dữ liệu quá lớn.');
  if (req.body !== undefined) { const b = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)); if (b.length > limit) fail(413, 'Dữ liệu quá lớn.'); return b; }
  const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, 'Dữ liệu quá lớn.'); chunks.push(chunk); } return Buffer.concat(chunks);
}
export async function readJson(req, max = 3500000) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Yêu cầu JSON.'); let result;
  try { result = JSON.parse((await readBody(req, max)).toString('utf8')); } catch (e) { if (e instanceof AppError) throw e; fail(400, 'JSON không hợp lệ.'); }
  if (!result || Array.isArray(result) || typeof result !== 'object') fail(400, 'Body phải là object.'); return result;
}
export function text(value, label, max = 12000, min = 1) { if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, `${label}: cần ${min}-${max} ký tự.`); return value.trim(); }
export function number(value, label, min, max) { if (!Number.isFinite(value) || value < min || value > max) fail(400, `${label}: phải trong khoảng ${min}-${max}.`); return value; }
export function consent(value) { if (value !== true) fail(400, 'Cần xác nhận quyền sử dụng giọng/hình ảnh và gửi dữ liệu cho nhà cung cấp.'); }
export function key(name) { const v = process.env[name]; if (!v) fail(503, `Chưa cấu hình ${name} trên Vercel.`, 'MISSING_KEY'); return v; }
export function json(res, data, status = 200) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(JSON.stringify(data)); }
export function publicError(e) { if (e instanceof AppError) return { status: e.status, error: e.message, code: e.code }; if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return { status: 504, error: 'Nhà cung cấp phản hồi quá chậm. Không tự gửi lại tác vụ tính phí.', code: 'UPSTREAM_TIMEOUT' }; return { status: 500, error: 'Không thể xử lý. Xem mã lỗi trong Vercel Logs, không chia sẻ API key.', code: 'INTERNAL_ERROR' }; }
export async function upstream(url, options = {}, provider = 'API', timeout = 48000) {
  const res = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (!res.ok) { await res.body?.cancel(); const reason = res.status === 401 || res.status === 403 ? 'API key hoặc quyền truy cập không hợp lệ' : res.status === 402 ? 'cần số dư/quyền sử dụng' : res.status === 429 ? 'đạt giới hạn, hãy giảm tần suất' : res.status === 404 ? 'model/tài nguyên không còn khả dụng' : 'từ chối dữ liệu hoặc đang lỗi'; fail(res.status === 429 ? 429 : 502, `${provider}: ${reason} (HTTP ${res.status}).`, 'UPSTREAM_ERROR'); }
  return res;
}