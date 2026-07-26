import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(selfPath), '..');
const skip = new Set(['node_modules', '.git', 'dist']);
const files = [];

function isJavaScriptFile(name) {
  return name.endsWith('.js') || name.endsWith('.mjs');
}

function hasModuleSyntax(source) {
  return String(source || '').split(/\r?\n/).some((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith('import ') || trimmed.startsWith('export ');
  });
}

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (isJavaScriptFile(item.name)) files.push(full);
  }
}

walk(root);
files.sort((a, b) => a.localeCompare(b));

// Parsing every file in this process needs V8's ESM parser, which is only reachable
// through vm.SourceTextModule under --experimental-vm-modules. Re-exec once with the
// flag: one extra process total instead of one `node --check` per file, which cost
// ~45ms each on Windows (~12s for this repo).
const canParseInProcess = typeof vm.SourceTextModule === 'function';
if (!canParseInProcess && !process.env.REL_AI_MCP_CHECK_CHILD) {
  const res = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', selfPath], {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, REL_AI_MCP_CHECK_CHILD: '1' }
  });
  // 0 = all files parsed, 1 = a real syntax error. Anything else means the runtime
  // rejected the flag, so fall through to the per-file checker below.
  if (res.status === 0 || res.status === 1) process.exit(res.status);
}

function parseInProcess(file, source, parseAsModule) {
  if (parseAsModule) new vm.SourceTextModule(source, { identifier: file });
  else new vm.Script(source, { filename: file });
}

function parseInSubprocess(file, source, parseAsModule) {
  const args = parseAsModule ? ['--input-type=module', '--check'] : ['--check', file];
  const options = parseAsModule
    ? { cwd: root, encoding: 'utf8', input: source }
    : { cwd: root, encoding: 'utf8' };
  const res = spawnSync(process.execPath, args, options);
  if (res.status !== 0) {
    const detail = `${res.stdout || ''}${res.stderr || ''}`.trim();
    throw new Error(detail || `node --check exited ${res.status}`);
  }
}

const parse = canParseInProcess ? parseInProcess : parseInSubprocess;

for (const file of files) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  const parseAsModule = file.endsWith('.mjs') || hasModuleSyntax(source);
  try {
    parse(file, source, parseAsModule);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`Syntax check failed: ${relative}`);
    process.exit(1);
  }
}

console.log(`Checked ${files.length} JavaScript files.`);
