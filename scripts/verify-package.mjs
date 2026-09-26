import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const zip = `dist/DichiarerAI-v${manifest.version}.zip`;
if (!fs.existsSync(zip)) throw new Error(`missing ${zip}`);
const listCommand = process.platform === 'win32'
  ? ['tar', ['-tf', zip]] : ['unzip', ['-Z1', zip]];
const entries = execFileSync(listCommand[0], listCommand[1], { encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean);
for (const required of ['manifest.json', 'background.js', 'lib/core.js',
  'lib/providers.js', 'lib/page-bridge.js', 'sidepanel/panel.html']) {
  if (!entries.includes(required)) throw new Error(`package missing ${required}`);
}
if (entries.some((name) => /^(tests|docs|scripts|node_modules)\//.test(name) ||
    /(^|\/)package(?:-lock)?\.json$/.test(name))) {
  throw new Error('development file found in package');
}
const digest = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
const checksum = `${zip}.sha256`;
fs.writeFileSync(checksum, `${digest}  ${zip.split('/').pop()}\n`);
console.log(`verify:package ${entries.length} entries, sha256 ${digest}`);
