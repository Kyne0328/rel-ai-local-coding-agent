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
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Generated ${path.relative(root, output)}`);
