import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.version !== '1.1.0') {
  throw new Error('manifest must be MV3 version 1.1.0');
}
const expectedHosts = [
  'https://dichiarazioneprecompilata.agenziaentrate.gov.it/*',
  'https://api.anthropic.com/*',
  'https://api.openai.com/*'
];
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHosts)) {
  throw new Error('unexpected host permissions');
}
for (const file of ['background.js', 'lib/core.js', 'lib/providers.js',
  'lib/page-bridge.js', 'sidepanel/panel.html', 'options/options.html',
  'LICENSE', 'PRIVACY.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`missing ${file}`);
}
const authored = ['background.js', 'manifest.json', 'README.md', 'PRIVACY.md',
  'SECURITY.md', 'RELEASE_NOTES.md', 'lib/core.js', 'lib/providers.js',
  'lib/page-bridge.js', 'sidepanel/panel.js', 'options/options.js'];
const secret = /(sk-(?:ant-)?[A-Za-z0-9_-]{20,}|BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY|C:\\Users\\|\/Users\/[^/]+\/)/;
for (const file of authored) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (secret.test(text)) throw new Error(`possible secret or personal path in ${file}`);
}
console.log('verify: manifest, files, permissions and secret scan passed');
