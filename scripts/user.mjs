import { hashPassword } from '../lib/core.mjs';
import { randomBytes } from 'node:crypto';
const username = process.argv[2];
if (!/^[a-zA-Z0-9_-]{1,50}$/.test(username || '') || ['admin', '__proto__', 'constructor', 'prototype'].includes(username)) { console.error('Usage: npm run user -- member_name'); process.exit(1); }
const password = randomBytes(18).toString('base64url');
console.log('Merge this object into APP_USERS_JSON in Vercel:');
console.log(JSON.stringify({ [username]: { role: 'member', passwordHash: hashPassword(password) } }));
console.log(`Give only this password to ${username}: ${password}`);