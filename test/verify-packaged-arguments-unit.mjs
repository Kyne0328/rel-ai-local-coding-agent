import assert from 'node:assert/strict';
import path from 'node:path';
import { parsePackagedDirectoryArgument, resolvePackagedDirectory } from '../scripts/packaged-directory.mjs';

const cases = [
  'C:\\Users\\Kyne\\Rel.AI MCP',
  'C:\\Users\\Kyne\\Rel.AI MCP Ω',
  'D:\\RelAI',
  'C:\\Program Files\\Rel.AI MCP',
  'C:\\RelAI'
];
for (const directory of cases) {
  assert.equal(parsePackagedDirectoryArgument(['--dir', directory]), directory);
  assert.equal(resolvePackagedDirectory('C:\\repo', ['--dir', directory], {
    platform: 'win32',
    cwd: 'C:\\repo'
  }), path.win32.normalize(directory));
}
assert.equal(parsePackagedDirectoryArgument([]), '');
assert.throws(() => parsePackagedDirectoryArgument(['--dir']), /requires/);
assert.throws(() => parsePackagedDirectoryArgument(['--dir', 'one', '--dir', 'two']), /only once/);

console.log('Packaged verification preserves Windows paths with spaces and Unicode.');
