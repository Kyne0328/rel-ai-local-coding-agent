import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');

function verifyNodePtyPackage(packageRoot, options = {}) {
  const label = String(options.label || 'node-pty');
  const entry = path.join(packageRoot, 'lib', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`${label} entry point is missing: ${entry}`);
  }
  try {
    const loaded = require(entry);
    const api = loaded?.spawn ? loaded : loaded?.default;
    if (!api || typeof api.spawn !== 'function') {
      throw new Error('node-pty did not expose a spawn function.');
    }
    return Object.freeze({ packageRoot, entry });
  } catch (error) {
    throw new Error(
      `${label} native runtime is not loadable for ${process.platform}-${process.arch}. `
      + `npm must run node-pty's install script so platforms without a bundled prebuild can compile the native addon.`,
      { cause: error }
    );
  }
}

function verifyNodePtyRuntime({ baseRoot = defaultRoot } = {}) {
  const candidates = [
    { label: 'root node-pty', packageRoot: path.join(baseRoot, 'node_modules', 'node-pty') },
    { label: 'Electron node-pty', packageRoot: path.join(baseRoot, 'electron', 'node_modules', 'node-pty') }
  ];
  const failures = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.packageRoot)) continue;
    try {
      const result = verifyNodePtyPackage(candidate.packageRoot, { label: candidate.label });
      console.log(`Verified ${candidate.label} native runtime for ${process.platform}-${process.arch}.`);
      return result;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  const detail = failures.length ? `\n  - ${failures.join('\n  - ')}` : '';
  throw new Error(
    `No loadable node-pty runtime is available for ${process.platform}-${process.arch}.${detail}\n`
    + `Ensure package.json and electron/package.json allowScripts approve the pinned node-pty version, then run npm ci in electron/.`
  );
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isEntrypoint) {
  try {
    verifyNodePtyRuntime();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { verifyNodePtyPackage, verifyNodePtyRuntime };
