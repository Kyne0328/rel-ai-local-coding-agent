import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openIndexDatabase, repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-repository-collection-'));
const workspaceRoot = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
fs.mkdirSync(path.join(workspaceRoot, '.agents', 'skills', 'vendor-skill'), { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'src', 'app.js'), 'export const applicationMarker = true;\n');
fs.writeFileSync(path.join(workspaceRoot, '.agents', 'skills', 'vendor-skill', 'tool.py'), 'def irrelevant_vendor_tool():\n    return True\n');

const workspace = { alias: 'collection-policy', path: workspaceRoot, context: {}, testCommands: {}, commands: {} };
const config = { stateDir };

try {
  await repositoryIntelligence.ensure(workspace, config, { force: true, watch: false });
  const db = openIndexDatabase(repositoryIndexPath(config, workspace), { readonly: true });
  try {
    const indexedPaths = db.prepare('SELECT path FROM files ORDER BY path').all().map(row => String(row.path));
    assert.ok(indexedPaths.includes('src/app.js'));
    assert.equal(indexedPaths.some(value => value.startsWith('.agents/skills/')), false,
      'installed agent skill implementations must not pollute repository search or relationship graphs');
  } finally {
    db.close();
  }
} finally {
  await repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

console.log('Repository Intelligence collection policy excludes installed agent skill implementations.');
