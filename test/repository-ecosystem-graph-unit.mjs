import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openIndexDatabase, repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-ecosystem-graph-'));
const stateDir = path.join(root, '.state');
const write = (relativePath, source) => {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, source, 'utf8');
};
write('go.mod', 'module example.com/acme\n\ngo 1.24\n');
write('internal/user/user.go', 'package user\nfunc New() int { return 1 }\n');
write('cmd/main.go', 'package main\nimport user "example.com/acme/internal/user"\nfunc main() { _ = user.New() }\n');
const workspace = { alias:'ecosystem-graph', path:root, context:{}, testCommands:{}, commands:{} };
const config = { stateDir };

try {
  const result = await repositoryIntelligence.ensure(workspace, config, { force:true });
  assert.equal(result.runtimeStatus, 'ready');
  const db = openIndexDatabase(repositoryIndexPath(config, workspace), { readonly:true });
  try {
    const resolved = db.prepare(`
      SELECT source.path AS source_path, i.specifier, i.target_path
      FROM imports i JOIN files source ON source.id=i.source_file_id
      WHERE source.path='cmd/main.go' AND i.specifier='example.com/acme/internal/user'
    `).get();
    assert.equal(resolved?.target_path, 'internal/user/user.go');
    const calls = db.prepare(`
      SELECT source.path AS source_path, target.path AS target_path, e.target_name, e.provider
      FROM edges e
      JOIN files source ON source.id=e.source_file_id
      JOIN files target ON target.id=e.target_file_id
      WHERE e.type='CALLS' AND source.path='cmd/main.go' AND e.target_name='New'
    `).all();
    assert.ok(calls.some(call => call.target_path === 'internal/user/user.go' && call.provider === 'resolver-go-v2'));
  } finally { db.close(); }
  console.log('Ecosystem-aware graph import and call resolution tests passed.');
} finally {
  await repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive:true, force:true });
}

