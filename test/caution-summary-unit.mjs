import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cautionSummary } = require('../src/productUx.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-caution-summary-'));
const auditPath = path.join(TMP, 'audit.jsonl');
const config = { stateDir: TMP, auditLogPath: auditPath };

function writeEntries(entries) {
  fs.writeFileSync(auditPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function isoMinusHours(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

// 1. No audit file -> empty workspaces
{
  try { fs.unlinkSync(auditPath); } catch (_) {}
  const r = cautionSummary(config, { windowHours: 24 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.workspaces, []);
  console.log('1. no audit file: OK');
}

// 2. Non-caution entries ignored
{
  writeEntries([
    { ts: isoMinusHours(1), tool: 'relai_write', workspace: 'a', ok: true },
    { ts: isoMinusHours(2), tool: 'relai_read', workspace: 'a', ok: true }
  ]);
  const r = cautionSummary(config, { windowHours: 24 });
  assert.deepEqual(r.workspaces, []);
  console.log('2. non-caution ignored: OK');
}

// 3. Caution entries inside window counted
{
  writeEntries([
    { ts: isoMinusHours(1), tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'cleared 3 files' },
    { ts: isoMinusHours(2), tool: 'relai_apply_bundle', workspace: 'a', cautionLevel: 'caution', cautionReason: 'applied prepared bundle' }
  ]);
  const r = cautionSummary(config, { windowHours: 24 });
  assert.equal(r.workspaces.length, 1);
  assert.equal(r.workspaces[0].count, 2);
  assert.equal(r.workspaces[0].recent.length, 2);
  console.log('3. caution counted: OK');
}

// 4. Entries outside window excluded
{
  writeEntries([
    { ts: isoMinusHours(25), tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'old' },
    { ts: isoMinusHours(1), tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'new' }
  ]);
  const r = cautionSummary(config, { windowHours: 24 });
  assert.equal(r.workspaces[0].count, 1);
  assert.equal(r.workspaces[0].recent[0].reason, 'new');
  console.log('4. window filter: OK');
}

// 5. Grouped per workspace
{
  writeEntries([
    { ts: isoMinusHours(1), tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'r1' },
    { ts: isoMinusHours(2), tool: 'relai_apply_bundle', workspace: 'b', cautionLevel: 'caution', cautionReason: 'r2' },
    { ts: isoMinusHours(3), tool: 'relai_apply_bundle', workspace: 'b', cautionLevel: 'caution', cautionReason: 'r3' }
  ]);
  const r = cautionSummary(config, { windowHours: 24 });
  assert.equal(r.workspaces.length, 2);
  const a = r.workspaces.find((w) => w.alias === 'a');
  const b = r.workspaces.find((w) => w.alias === 'b');
  assert.equal(a.count, 1);
  assert.equal(b.count, 2);
  console.log('5. grouped per workspace: OK');
}

// 6. recent[] capped at 5
{
  const entries = [];
  for (let i = 0; i < 8; i++) entries.push({ ts: isoMinusHours(i + 1), tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'r' + i });
  writeEntries(entries);
  const r = cautionSummary(config, { windowHours: 24, limit: 50 });
  assert.equal(r.workspaces[0].count, 8);
  assert.equal(r.workspaces[0].recent.length, 5);
  console.log('6. recent capped at 5: OK');
}

// 7. Malformed ts ignored
{
  writeEntries([
    { tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'no ts' },
    { ts: 'not-a-date', tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'bad ts' },
    { ts: isoMinusHours(1), tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'good' }
  ]);
  const r = cautionSummary(config, { windowHours: 24 });
  assert.equal(r.workspaces[0].count, 1);
  console.log('7. malformed ts ignored: OK');
}

// 8. Missing workspace alias goes to __unknown__
{
  writeEntries([
    { ts: isoMinusHours(1), tool: 'relai_clear_files', cautionLevel: 'caution', cautionReason: 'no ws' }
  ]);
  const r = cautionSummary(config, { windowHours: 24 });
  assert.equal(r.workspaces[0].alias, '__unknown__');
  console.log('8. missing alias: OK');
}

// 9. windowHours custom
{
  writeEntries([
    { ts: isoMinusHours(1), tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'r' },
    { ts: isoMinusHours(3), tool: 'relai_clear_files', workspace: 'a', cautionLevel: 'caution', cautionReason: 'r' }
  ]);
  const r = cautionSummary(config, { windowHours: 2 });
  assert.equal(r.workspaces[0].count, 1);
  console.log('9. custom window: OK');
}

// 10. generatedAt + windowHours echoed
{
  const r = cautionSummary(config, { windowHours: 12 });
  assert.match(r.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(r.windowHours, 12);
  console.log('10. result shape: OK');
}

// Cleanup
try { fs.unlinkSync(auditPath); } catch (_) {}
try { fs.rmdirSync(TMP); } catch (_) {}

console.log('caution-summary unit tests passed.');
