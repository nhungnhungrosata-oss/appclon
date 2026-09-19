import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import handler from '../api/index.js';

test('deployment contains every HTML asset and local module import', async () => {
  const html = await readFile('public/index.html', 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']\/([^"']+)["']/g)) {
    await access(resolve('public', match[1]));
  }
  for (const file of ['public/app.js', 'public/media.js', 'public/fish-handoff.js']) {
    const source = await readFile(file, 'utf8');
    assert.ok(source.length > 100, `${file} must not be a placeholder`);
    for (const match of source.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
      await access(resolve(dirname(file), match[1]));
    }
  }
});

test('deployment uses a real Node API plus static public output', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.functions['api/index.js'].maxDuration, 60);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '22.x');
  assert.equal(typeof handler, 'function');
});

test('health works without environment secrets and does not call AI services', async () => {
  for (const name of ['APP_PASSWORD', 'SESSION_SECRET', 'APP_USERS_JSON', 'FISH_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY']) delete process.env[name];
  const server = createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const httpFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected provider call'); };
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/index?action=health`;
    const response = await httpFetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: true, service: 'cliplab' });
    assert.equal(calls, 0);
    const session = await httpFetch(url.replace('health', 'session'));
    assert.equal(session.status, 401);
  } finally {
    global.fetch = httpFetch;
    await new Promise(r => server.close(r));
  }
});
