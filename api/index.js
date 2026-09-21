import { authenticate, users, verifyPassword, safeEqual, sessionCookie, checkOrigin, readJson, text, json, publicError, sha, fail, secret, keyHint } from '../lib/core.mjs';
import { hasRedis, limit, get, setPersistent } from '../lib/store.mjs';
import { models, generateText, vbeeSubmit, vbeeStatus, vbeeAudio, assignedVoice, analyze } from '../lib/providers.mjs';
import { transcribeCloneChunk } from '../lib/video-clone.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url, 'https://localhost');
    const action = url.searchParams.get('action') || 'session';
    if (!['GET', 'POST'].includes(req.method)) fail(405, 'Method not allowed.');
    if (action === 'health' && req.method === 'GET') return json(res, { ok: true, service: 'cliplab' });

    // Vbee callback is intentionally unauthenticated. The app polls Vbee for the
    // authoritative result; the callback is accepted only to satisfy async TTS.
    if (action === 'vbee-callback' && req.method === 'POST') {
      res.statusCode = 204;
      return res.end();
    }
    if (req.method === 'POST') checkOrigin(req);

    if (action === 'login' && req.method === 'POST') {
      const b = await readJson(req, 4000);
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
      await limit(`login:${sha(ip)}`, 12, 900);
      secret();
      const all = users();
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
      ...session,
      models: models(),
      providers: {
        vbee: !!(process.env.VBEE_APP_ID && (process.env.VBEE_TOKEN || process.env.VBEE_ACCESS_TOKEN)),
        openai: !!process.env.OPENAI_API_KEY,
        deepseek: !!process.env.DEEPSEEK_API_KEY
      },
      assignedVoice: await assignedVoice(session.username),
      limiter: hasRedis() ? 'redis' : 'memory',
      shared: Object.keys(users()).length > 1
    });

    if (action === 'tts-audio' && req.method === 'GET') {
      const user = session.username;
      await limit(`audio:${sha(user)}`, 120, 60);
      const token = url.searchParams.get('token') || '';
      const { data, contentType } = await vbeeAudio(user, token);
      const total = data.length;
      const rawRange = req.headers.range;
      let start = 0, end = total - 1, partial = false;

      if (typeof rawRange === 'string') {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rawRange.trim());
        if (match) {
          start = Number(match[1]);
          end = match[2] ? Number(match[2]) : total - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= total) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${total}`);
            return res.end();
          }
          end = Math.min(end, total - 1);
          partial = true;
        }
      }

      const body = partial ? data.subarray(start, end + 1) : data;
      res.statusCode = partial ? 206 : 200;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(body.length));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', 'inline; filename="ibee-audio.mp3"');
      if (partial) res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      return res.end(body);
    }

    if (req.method !== 'POST') fail(405, 'Method not allowed.');
    const user = session.username;
    await limit(`burst:${sha(user)}`, 240, 60);

    const b = await readJson(req);
    if (action === 'text') return json(res, await generateText(user, b));
    if (action === 'analysis') return json(res, await analyze(user, b));

    if (action === 'tts-submit') {
      const callbackBase = `https://${req.headers.host}`;
      return json(res, await vbeeSubmit(user, b, callbackBase));
    }
    if (action === 'tts-status') return json(res, await vbeeStatus(user, b.token));
    if (action === 'clone-transcribe') return json(res, await transcribeCloneChunk(user, b));

    if (action === 'admin-state') {
      if (session.role !== 'admin') fail(403, 'Chỉ admin được quản lý.');
      const voices = await get('vbee-professional-voices') || [];
      const list = [];
      for (const [username, record] of Object.entries(users())) {
        list.push({ username, role: record.role || 'member', voiceCode: await get(`voice-assignment:${username}`) || '' });
      }
      return json(res, { voices, users: list, redis: hasRedis(), diagnostics: { openai: keyHint('OPENAI_API_KEY') } });
    }

    if (action === 'admin-add-voice') {
      if (session.role !== 'admin') fail(403, 'Chỉ admin được quản lý.');
      if (!hasRedis()) fail(503, 'Cần Upstash Redis để lưu danh sách giọng.', 'REDIS_REQUIRED');
      const label = text(b.label, 'Tên giọng', 80);
      const code = text(b.code, 'Mã giọng Ibee', 180);
      if (!/^[a-zA-Z0-9._:-]{2,180}$/.test(code)) fail(400, 'Mã giọng Ibee không hợp lệ.');
      const voices = await get('vbee-professional-voices') || [];
      const next = [...voices.filter(v => v.code !== code), { code, label, kind: 'professional_clone' }];
      await setPersistent('vbee-professional-voices', next);
      return json(res, { voices: next });
    }

    if (action === 'admin-remove-voice') {
      if (session.role !== 'admin') fail(403, 'Chỉ admin được quản lý.');
      const code = text(b.code, 'Mã giọng', 180);
      const voices = (await get('vbee-professional-voices') || []).filter(v => v.code !== code);
      await setPersistent('vbee-professional-voices', voices);
      return json(res, { voices });
    }

    if (action === 'admin-assign-voice') {
      if (session.role !== 'admin') fail(403, 'Chỉ admin được quản lý.');
      const username = text(b.username, 'Tài khoản', 50);
      if (!users()[username]) fail(404, 'Không có tài khoản này.');
      const voiceCode = typeof b.voiceCode === 'string' ? b.voiceCode.trim() : '';
      const voices = await get('vbee-professional-voices') || [];
      if (voiceCode && !voices.some(v => v.code === voiceCode && v.kind === 'professional_clone')) fail(400, 'Giọng chưa nằm trong danh sách Nhân bản chuyên nghiệp của admin.');
      await setPersistent(`voice-assignment:${username}`, voiceCode);
      return json(res, { ok: true });
    }

    fail(404, 'Không tìm thấy tác vụ.');
  } catch (e) {
    const err = publicError(e);
    console.error(JSON.stringify({ code: err.code, errorClass: e?.name, status: err.status }));
    if (!res.headersSent) return json(res, { error: err.error, code: err.code }, err.status);
    res.end();
  }
}
