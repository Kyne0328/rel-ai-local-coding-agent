import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collectTextFiles } from '../src/safety.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-collect-ext-'));
fs.writeFileSync(path.join(tmp, 'app.js'), 'const a = 1;\n');
fs.writeFileSync(path.join(tmp, 'notes.txt'), 'plain text\n');
// Unknown extension + binary content → must still be sniffed and skipped.
fs.writeFileSync(path.join(tmp, 'blob.dat'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
// No extension + text content → sniffed and included.
fs.writeFileSync(path.join(tmp, 'Procfile'), 'web: node server.js\n');
// Known text extension with an embedded null byte → trusted by extension, included.
fs.writeFileSync(path.join(tmp, 'weird.js'), Buffer.concat([Buffer.from('const b = "'), Buffer.from([0x00]), Buffer.from('";\n')]));
const expandedTextExtensions = ['.hcl', '.tf', '.tfvars', '.psm1', '.psd1', '.markdown', '.mdx', '.dockerfile', '.graphql', '.gql', '.proto', '.r', '.asm', '.s', '.gd', '.nix', '.hs', '.lhs', '.jl', '.clj', '.cljs', '.cljc', '.edn', '.groovy', '.pl', '.pm', '.t'];
for (const [index, extension] of expandedTextExtensions.entries()) {
  fs.writeFileSync(path.join(tmp, `known-${index}${extension}`), Buffer.from([0x41, 0x00, 0x42]));
}

try {
  const result = collectTextFiles(tmp, {});
  assert.deepEqual(result.files.sort(), ['Procfile', 'app.js', ...expandedTextExtensions.map((extension, index) => `known-${index}${extension}`), 'notes.txt', 'weird.js'].sort());
  const skippedBinary = result.skipped.find((item) => item.path === 'blob.dat');
  assert.equal(skippedBinary?.reason, 'binary-looking file');
  console.log('Extension-first collection unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
