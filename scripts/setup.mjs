import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
try { await access('.env.local'); console.error('.env.local exists; refusing to overwrite.'); process.exit(1); } catch {}
let env = await readFile('.env.example', 'utf8');
const password = randomBytes(18).toString('base64url');
env = env.replace('APP_PASSWORD=', `APP_PASSWORD=${password}`).replace('SESSION_SECRET=', `SESSION_SECRET=${randomBytes(48).toString('hex')}`);
await writeFile('.env.local', env, { mode: 0o600 });
console.log(`Created .env.local\nUsername: admin\nPassword: ${password}\nAdd your provider API keys to .env.local. NEVER commit this file.`);