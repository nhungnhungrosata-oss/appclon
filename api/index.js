import { authenticate, users, verifyPassword, safeEqual, sessionCookie, checkOrigin, readBody, readJson, text, json, publicError, sha, fail, secret } from '../lib/core.mjs';
import { hasRedis, limit } from '../lib/store.mjs';
import { models, freeUntil, generateText, speech, analyze, googleStart, googleChunk, googleFile } from '../lib/providers.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url, 'https://localhost');
    const action = url.searchParams.get('action') || 'session';
    if (!['GET', 'POST'].includes(req.method)) fail(405, 'Method not allowed.');
    if (req.method === 'POST') checkOrigin(req);
    if (action === 'login' && req.method === 'POST') {
      const b = await readJson(req, 4000);
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
      await limit(\`login:\${sha(ip)}\`, 12, 900);
      secret();
      const all = users();
      if (!Object.keys(all).length) fail(503, 'Chạy npm run setup hoặc cấu hình APP_PASSWORD và SESSION_SECRET trên Vercel.', 'SETUP_REQUIRED');
      const name = text(b.username, 'Tên đăng nhập', 50);
      if (!/^[a-zA-Z0-9_-]{1,50}$/.test(name)) fail(401, 'Sai tên đăng nhập hoặc mật khẩu.');
      const password = text(b.password, 'Mật khẩu', 500);
      const record = all[name];
      const valid = record?.passwordHash ? verifyPassword(password, record.passwordHash) : record?.password ? safeEqual(sha(password), sha(record.password)) : false;
      if (!valid) fail(401, 'Sai tên đăng nhập hoặc mật khẩu.');
      const secure = req.headers['x-forwarded-proto'] === 'https' || req.headers.origin?.startsWith('https:') || !!process.env.VERCEL;
      res.setHeader('Set-Cookie', sessionCookie(name, record, secure));
      return json(res, { username: name });
    }
    if (action === 'logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'cliplab_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      return json(res, { ok: true });
    }
    const session = authenticate(req);
    if (action === 'session' && req.method === 'GET') return json(res, {
      ...session, models: models(), fishFreeUntil: freeUntil(),
      providers: { fish: !!process.env.FISH_API_KEY, google: !!process.env.GOOGLE_API_KEY, openai: !!process.env.OPENAI_API_KEY, deepseek: !!process.env.DEEPSEEK_API_KEY },
      lipSync: { provider: 'fish-audio', mode: 'web-handoff', apiIntegrated: false, website: 'https://fish.audio/app/image-video/' },
      limiter: hasRedis() ? 'redis' : 'memory', shared: Object.keys(users()).length > 1
    });
    if (req.method !== 'POST') fail(405, 'Method not allowed.');
    if (['fal-upload', 'lip-submit', 'lip-status', 'lip-cancel'].includes(action)) fail(410, 'Tích hợp lip-sync cũ đã gỡ. Mở Fish Creative trong mục Lip-sync; bản này chưa tích hợp API tạo video của Fish.', 'LIPSYNC_WEB_ONLY');
    const user = session.username;
    await limit(\`burst:\${sha(user)}\`, 240, 60);
    if (action === 'google-chunk') {
      const b = await readBody(req, 2 * 1024 * 1024);
      return json(res, await googleChunk(user, req.headers['x-upload-ticket'], b));
    }
    const b = await readJson(req);
    if (action === 'text') return json(res, await generateText(user, b));
    if (action === 'analysis') return json(res, await analyze(user, b));
    if (action === 'google-start') return json(res, await googleStart(user, b));
    if (action === 'google-file') return json(res, await googleFile(user, b.fileToken));
    if (action === 'google-delete') return json(res, await googleFile(user, b.fileToken, true));
    if (action === 'tts') {
      const r = await speech(user, b);
      const chunks = []; let bytes = 0;
      for await (const chunk of r.body) {
        bytes += chunk.length;
        if (bytes > 3900000) fail(413, 'Audio quá dài. Chia kịch bản thành các đoạn ngắn hơn.');
        chunks.push(Buffer.from(chunk));
      }
      if (!bytes) fail(502, 'Fish không trả audio.');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', 'attachment; filename="cliplab-voice.mp3"');
      res.setHeader('X-Fish-Model', 's2.1-pro-free');
      return res.end(Buffer.concat(chunks));
    }
    fail(404, 'Không tìm thấy tác vụ.');
  } catch (e) {
    const err = publicError(e);
    console.error(JSON.stringify({ code: err.code, errorClass: e?.name, status: err.status }));
    if (!res.headersSent) return json(res, { error: err.error, code: err.code }, err.status);
    res.end();
  }
}
