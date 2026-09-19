import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import handler from '../api/index.js';
const root = resolve('public');
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const securityHeaders = Object.fromEntries(config.headers[0].headers.map(h => [h.key, h.value]));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
createServer(async (req, res) => {
  for (const [k, v] of Object.entries(securityHeaders)) res.setHeader(k, v);
  if (req.url.startsWith('/api/')) return handler(req, res);
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`ClipLab: http://localhost:${process.env.PORT || 3000}`));