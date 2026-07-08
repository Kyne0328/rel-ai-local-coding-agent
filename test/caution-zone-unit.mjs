import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyCaution } = require('../src/cautionZone.js');

// 1. clear_files with 2 paths -> null (under threshold)
{
  const r = classifyCaution('relai_clear_files', { paths: ['a.js', 'b.js'] }, {}, {});
  assert.equal(r.level, null);
  console.log('1. clear 2 files: OK');
}

// 2. clear_files with 3 paths -> caution
{
  const r = classifyCaution('relai_clear_files', { paths: ['a.js', 'b.js', 'c.js'] }, {}, {});
  assert.equal(r.level, 'caution');
  assert.match(r.reason, /cleared 3 files/);
  console.log('2. clear 3 files: OK');
}

// 3. clear_files mixing path + paths -> total counted
{
  const r = classifyCaution('relai_clear_files', { path: 'x.js', paths: ['a.js', 'b.js'] }, {}, {});
  assert.equal(r.level, 'caution');
  assert.match(r.reason, /cleared 3 files/);
  console.log('3. clear mix path+paths: OK');
}

// 4. apply_bundle -> always caution
{
  const r = classifyCaution('relai_apply_bundle', { bundlePath: 'x.zip' }, { ok: true }, {});
  assert.equal(r.level, 'caution');
  assert.equal(r.reason, 'applied prepared bundle');
  console.log('4. apply_bundle always caution: OK');
}

// 5. apply_update with 4 touched -> null
{
  const r = classifyCaution('relai_apply_update', { patch: 'x' }, { touchedPaths: ['a', 'b', 'c', 'd'] }, {});
  assert.equal(r.level, null);
  console.log('5. apply_update 4 files: OK');
}

// 6. apply_update with 5 touched -> caution
{
  const r = classifyCaution('relai_apply_update', { patch: 'x' }, { touchedPaths: ['a', 'b', 'c', 'd', 'e'] }, {});
  assert.equal(r.level, 'caution');
  assert.match(r.reason, /touching 5 files/);
  console.log('6. apply_update 5 files: OK');
}

// 7. apply_update with bytes >= threshold -> caution
{
  const bigPatch = 'x'.repeat(102400);
  const r = classifyCaution('relai_apply_update', { patch: bigPatch }, {}, {});
  assert.equal(r.level, 'caution');
  assert.match(r.reason, /102400 bytes/);
  console.log('7. apply_update 100KB: OK');
}

// 8. apply_update with bytes < threshold -> null
{
  const smallPatch = 'x'.repeat(102399);
  const r = classifyCaution('relai_apply_update', { patch: smallPatch }, {}, {});
  assert.equal(r.level, null);
  console.log('8. apply_update <100KB: OK');
}

// 9. write to .relaiignore -> caution
{
  const r = classifyCaution('relai_write', { path: '.relaiignore', content: 'x' }, {}, {});
  assert.equal(r.level, 'caution');
  assert.equal(r.reason, 'workspace config path modified');
  console.log('9. write .relaiignore: OK');
}

// 10. write to src/foo.js -> null
{
  const r = classifyCaution('relai_write', { path: 'src/foo.js', content: 'x' }, {}, {});
  assert.equal(r.level, null);
  console.log('10. write src/foo.js: OK');
}

// 11. edit to package.json -> caution
{
  const r = classifyCaution('relai_edit', { path: 'package.json' }, {}, {});
  assert.equal(r.level, 'caution');
  console.log('11. edit package.json: OK');
}

// 12. write to .github/workflows/ci.yml -> caution
{
  const r = classifyCaution('relai_write', { path: '.github/workflows/ci.yml' }, {}, {});
  assert.equal(r.level, 'caution');
  console.log('12. write .github/workflows: OK');
}

// 13. Custom thresholds override defaults
{
  const r = classifyCaution('relai_clear_files', { paths: ['a.js', 'b.js'] }, {}, { cautionZone: { massClearThreshold: 2 } });
  assert.equal(r.level, 'caution');
  assert.match(r.reason, /cleared 2 files/);
  console.log('13. custom threshold: OK');
}

// 14. Invalid threshold falls back to default
{
  const r = classifyCaution('relai_clear_files', { paths: ['a.js', 'b.js'] }, {}, { cautionZone: { massClearThreshold: 'oops' } });
  assert.equal(r.level, null);
  console.log('14. invalid threshold: OK');
}

// 15. Unknown tool -> null
{
  const r = classifyCaution('relai_read', { paths: ['a'] }, {}, {});
  assert.equal(r.level, null);
  console.log('15. relai_read no caution: OK');
}

// 16. Backslash path normalized
{
  const r = classifyCaution('relai_write', { path: String.raw`.github\workflows\ci.yml` }, {}, {});
  assert.equal(r.level, 'caution');
  console.log('16. backslash path: OK');
}

console.log('caution-zone unit tests passed.');
