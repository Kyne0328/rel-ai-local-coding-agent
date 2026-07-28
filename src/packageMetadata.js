import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const packageJsonPath = path.join(packageRoot, 'package.json');
const packageMetadata = Object.freeze(JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')));

function resolvePackagePath(...segments) {
  return path.join(packageRoot, ...segments);
}

export { packageMetadata, packageRoot, packageJsonPath, resolvePackagePath };
