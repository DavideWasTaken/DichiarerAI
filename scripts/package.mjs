import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const output = `dist/DichiarerAI-v${manifest.version}.zip`;
fs.mkdirSync('dist', { recursive: true });
if (fs.existsSync(output)) fs.rmSync(output);
const files = ['manifest.json', 'background.js', 'icons', 'lib/core.js',
  'lib/providers.js', 'lib/page-bridge.js', 'lib/xlsx.full.min.js', 'options',
  'sidepanel', 'LICENSE', 'PRIVACY.md', 'SECURITY.md',
  'THIRD_PARTY_NOTICES.md', 'licenses/SheetJS-Apache-2.0.txt'];
execFileSync('git', ['archive', '--format=zip', `--output=${output}`, 'HEAD', '--', ...files],
  { stdio: 'inherit' });
console.log(`package: wrote ${output}`);
