import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { safeReadJson } = require('../src/safety.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-read-json-'));

// valid JSON
const validFile = path.join(tmp, 'valid.json');
fs.writeFileSync(validFile, '{"ok":true,"count":3}');
const result = safeReadJson(validFile);
assert.deepEqual(result, { ok: true, count: 3 }, 'valid JSON parsed correctly');

// malformed JSON
const badFile = path.join(tmp, 'bad.json');
fs.writeFileSync(badFile, '{broken json{{');
const warned = [];
const orig = console.warn;
console.warn = (...args) => warned.push(args.join(' '));
const badResult = safeReadJson(badFile);
console.warn = orig;
assert.equal(badResult, null, 'malformed JSON returns null');
assert.ok(warned.length > 0, 'warning logged on bad JSON');
assert.ok(warned[0].includes(badFile), 'warning includes file path');

// missing file
const missingFile = path.join(tmp, 'missing.json');
const warned2 = [];
console.warn = (...args) => warned2.push(args.join(' '));
const missingResult = safeReadJson(missingFile);
console.warn = orig;
assert.equal(missingResult, null, 'missing file returns null');
assert.ok(warned2.length > 0, 'warning logged for missing file');

// empty file
const emptyFile = path.join(tmp, 'empty.json');
fs.writeFileSync(emptyFile, '');
const warned3 = [];
console.warn = (...args) => warned3.push(args.join(' '));
const emptyResult = safeReadJson(emptyFile);
console.warn = orig;
assert.equal(emptyResult, null, 'empty file returns null');

// custom fallback
const fallbackResult = safeReadJson(missingFile, { default: true });
assert.deepEqual(fallbackResult, { default: true }, 'custom fallback returned on error');

fs.rmSync(tmp, { recursive: true });
console.log('safeReadJson unit tests passed.');
