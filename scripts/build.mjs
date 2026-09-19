import { access, readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const file of ['public/index.html', 'public/styles.css', 'public/app.js', 'public/media.js', 'public/fish-handoff.js', 'api/index.js']) await access(file);
for (const dir of ['api', 'lib', 'public', 'scripts']) {
  for (const file of await readdir(dir)) if (/\.(mjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
}
for (const file of await readdir('public')) {
  if (file.startsWith('.env') || /private.*key/i.test(file)) throw new Error('Secret file found in public/');
}
JSON.parse(await readFile('vercel.json', 'utf8'));
console.log('Build passed: native ES modules, static frontend, Node.js API. No bundler required.');