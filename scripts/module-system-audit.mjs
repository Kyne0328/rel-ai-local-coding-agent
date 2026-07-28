import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'module-system-baseline.json'), 'utf8'));
const files = baseline.roots.flatMap(directory => collectJavaScript(path.join(root, directory)));
const summary = { commonjs: [], esm: [], mixed: [], script: [] };

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const hasEsm = /^\s*(?:import|export)\s/m.test(source);
  const hasCommonJs = /\brequire\s*\(|\bmodule\.exports\b|\bexports\./m.test(source);
  const kind = hasEsm && hasCommonJs ? 'mixed' : hasEsm ? 'esm' : hasCommonJs ? 'commonjs' : 'script';
  summary[kind].push(path.relative(root, file).replaceAll('\\', '/'));
}

const failures = [];
if (summary.commonjs.length > baseline.maxCommonJsFiles) {
  failures.push(`CommonJS file count increased from the migration ceiling ${baseline.maxCommonJsFiles} to ${summary.commonjs.length}.`);
}
if (summary.esm.length < baseline.minEsmFiles) {
  failures.push(`ESM file count fell below the migration floor ${baseline.minEsmFiles}: ${summary.esm.length}.`);
}
if (summary.mixed.length > baseline.maxMixedFiles) {
  failures.push(`Mixed ESM/CommonJS files are prohibited: ${summary.mixed.join(', ')}`);
}
if (summary.script.length !== baseline.allowedScriptFiles) {
  failures.push(`Unclassified script count changed from ${baseline.allowedScriptFiles} to ${summary.script.length}: ${summary.script.join(', ')}`);
}
const commonJsUi = summary.commonjs.filter(file => file.startsWith('src/ui/'));
if (commonJsUi.length) failures.push(`Browser UI source must remain ESM-only: ${commonJsUi.join(', ')}`);

console.log(`Module system inventory: ${summary.esm.length} ESM, ${summary.commonjs.length} CommonJS, ${summary.mixed.length} mixed, ${summary.script.length} scripts.`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

function collectJavaScript(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...collectJavaScript(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) output.push(absolute);
  }
  return output;
}
