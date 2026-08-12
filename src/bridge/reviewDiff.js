import * as fs from 'node:fs';
import { looksBinary, resolveSafePath } from '../safety.js';

function truncateDiff(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/u, '')
    + `\n[rel-ai-mcp diff truncated at ${maxBytes} bytes]`;
}

function buildUntrackedDiff(workspace, paths) {
  const sections = [];
  for (const relativePath of paths) {
    try {
      const safe = resolveSafePath(workspace.path, relativePath, { operation: 'review' });
      const data = fs.readFileSync(safe.absolutePath);
      if (looksBinary(data)) {
        sections.push(`\ndiff --git a/${safe.relativePath} b/${safe.relativePath}\nnew file mode 100644\nBinary files /dev/null and b/${safe.relativePath} differ\n`);
        continue;
      }
      const text = data.toString('utf8').replaceAll('\r\n', '\n');
      const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
      sections.push(['', `diff --git a/${safe.relativePath} b/${safe.relativePath}`, 'new file mode 100644', '--- /dev/null', `+++ b/${safe.relativePath}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`), ''].join('\n'));
    } catch (error) {
      sections.push(`\n[rel-ai-mcp could not read untracked file ${relativePath}: ${error instanceof Error ? error.message : String(error)}]\n`);
    }
  }
  return sections.join('');
}

function normalizePaths(values) {
  return [...new Set((values || []).map(value => String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '')).filter(Boolean))].sort();
}

export { buildUntrackedDiff, normalizePaths, truncateDiff };
