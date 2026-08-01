import fs from 'node:fs';
import path from 'node:path';
import { runNpm } from './npm-cli.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist', 'sbom.cdx.json');
const result = runNpm(['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'npm sbom failed.\n');
  process.exit(result.status || 1);
}
const document = JSON.parse(result.stdout);
const ngrokManifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'ngrok', 'manifest.json'), 'utf8'));
const ngrok = ngrokManifest.platforms.win32;
document.components = [
  ...(document.components || []),
  {
    type: 'application',
    'bom-ref': `pkg:generic/ngrok@${ngrokManifest.version}?arch=x86_64&os=windows`,
    name: 'ngrok',
    version: ngrokManifest.version,
    supplier: { name: 'ngrok, Inc.' },
    hashes: [{ alg: 'SHA-256', content: ngrok.sha256 }],
    externalReferences: [{ type: 'distribution', url: ngrok.url }]
  }
];
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Generated ${path.relative(root, output)}`);
