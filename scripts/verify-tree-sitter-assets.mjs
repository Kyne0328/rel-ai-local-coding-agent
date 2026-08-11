import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';
import { parserForLanguage } from '../src/repository/intelligence/languages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = path.join(root, 'vendor', 'tree-sitter');
const manifestFile = path.join(vendorRoot, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (manifest.schemaVersion !== 1) throw new Error(`Unsupported Tree-sitter asset manifest schema ${manifest.schemaVersion}`);
for (const field of ['name','version','integrity','repository']) {
  if (!String(manifest.sourcePackage?.[field] || '').trim()) throw new Error(`Tree-sitter manifest sourcePackage.${field} is required.`);
}
const entries = Object.entries(manifest.grammars || {});
if (!entries.length) throw new Error('Tree-sitter manifest has no grammars.');

await Parser.init();
const declaredFiles = new Set();
let totalBytes = 0;
for (const [language, entry] of entries) {
  for (const field of ['file','sourcePath','sha256','grammarDependency']) {
    if (!String(entry?.[field] || '').trim()) throw new Error(`${language} manifest entry is missing ${field}.`);
  }
  const relative = String(entry.file).replaceAll('\\','/');
  if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`${language} parser path escapes vendor root.`);
  declaredFiles.add(relative);
  const file = path.join(vendorRoot, ...relative.split('/'));
  if (!fs.existsSync(file)) throw new Error(`${language} parser asset is missing: ${relative}`);
  const data = fs.readFileSync(file);
  const digest = crypto.createHash('sha256').update(data).digest('hex');
  if (data.length !== Number(entry.bytes)) throw new Error(`${language} parser byte size mismatch: expected ${entry.bytes}, got ${data.length}`);
  if (digest !== String(entry.sha256)) throw new Error(`${language} parser SHA-256 mismatch.`);
  const configured = parserForLanguage(language);
  const expectedPath = `vendor/tree-sitter/${relative}`;
  if (configured?.path !== expectedPath) throw new Error(`${language} parser registry path mismatch: expected ${expectedPath}, got ${configured?.path || 'none'}`);
  let grammar = null;
  try {
    grammar = await Language.load(file);
    if (!grammar) throw new Error('Language.load returned no grammar.');
  } catch (error) {
    throw new Error(`${language} parser is incompatible with the bundled web-tree-sitter runtime: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    try { grammar?.delete?.(); } catch {}
  }
  totalBytes += data.length;
}

const actualFiles = new Set(listWasm(vendorRoot).map(file => path.relative(vendorRoot, file).replaceAll('\\','/')));
for (const file of actualFiles) if (!declaredFiles.has(file)) throw new Error(`Undeclared vendored parser asset: ${file}`);
for (const file of declaredFiles) if (!actualFiles.has(file)) throw new Error(`Declared parser asset not found: ${file}`);

console.log(`Verified ${entries.length} vendored Tree-sitter grammars (${totalBytes} bytes), checksums, registry paths, and runtime ABI compatibility.`);

function listWasm(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listWasm(file));
    else if (entry.isFile() && entry.name.endsWith('.wasm')) result.push(file);
  }
  return result;
}

