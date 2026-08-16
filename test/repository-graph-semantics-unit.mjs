import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openIndexDatabase, repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-graph-semantics-'));
const stateDir = path.join(root, '.state');
const workspaceRoot = path.join(root, 'workspace');
fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
fs.mkdirSync(path.join(workspaceRoot, 'test'), { recursive: true });

fs.writeFileSync(path.join(workspaceRoot, 'src', 'service.ts'), `
export class AccountService {
  save() { return true; }
}
`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'routes.ts'), `
export function getAccounts() { return ['a']; }
router.get('/api/accounts', getAccounts);
`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'client.ts'), `
export async function loadAccounts() {
  return fetch('/api/accounts');
}
export async function loadAccountsAbsolute() {
  return fetch('https://api.example.test/api/accounts?limit=10');
}
`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'react.ts'), 'export const localReact = true;\n');
fs.writeFileSync(path.join(workspaceRoot, 'src', 'bare-import.ts'), "import React from 'react';\nexport const value = React;\n");
fs.writeFileSync(path.join(workspaceRoot, 'src', 'noise.ts'), `
// router.get('/ghost', ghostHandler);
// bus.emit('message', payload);
const note = "import Ghost from 'fake-package'; router.get('/string-ghost', ghostHandler)";
export const noise = note;
`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'generic-listener.ts'), `
export function onMessage() { return true; }
bus.on('message', onMessage);
`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'generic-emitter.ts'), `
export function publishMessage() { bus.emit('message', { ok: true }); }
`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'listener.ts'), `
export function onAccountSaved() { return true; }
bus.on('account:saved', onAccountSaved);
`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'emitter.ts'), `
export function publishAccountSaved() {
  bus.emit('account:saved', { id: 1 });
}
`);
fs.writeFileSync(path.join(workspaceRoot, 'test', 'service.test.ts'), `
import { AccountService } from '../src/service';
const service = new AccountService();
service.save();
`);

const workspace = { alias: 'graph-semantics', path: workspaceRoot, context: {}, testCommands: {}, commands: {} };
const config = { stateDir };

try {
  await repositoryIntelligence.ensure(workspace, config);
  const db = openIndexDatabase(repositoryIndexPath(config, workspace), { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT e.type, e.target_name, e.provider,
             source.path AS source_path, target.path AS target_path,
             source_symbol.qualified_name AS source_symbol, target_symbol.qualified_name AS target_symbol
      FROM edges e
      JOIN files source ON source.id=e.source_file_id
      LEFT JOIN files target ON target.id=e.target_file_id
      LEFT JOIN symbols source_symbol ON source_symbol.id=e.source_symbol_id
      LEFT JOIN symbols target_symbol ON target_symbol.id=e.target_symbol_id
      WHERE e.type IN ('TESTS','HANDLES','HTTP_CALLS','LISTENS_ON','EMITS')
      ORDER BY e.type, source.path, e.target_name
    `).all().map(row => ({
      type: String(row.type), targetName: row.target_name == null ? null : String(row.target_name), provider: String(row.provider),
      sourcePath: String(row.source_path), targetPath: row.target_path == null ? null : String(row.target_path),
      sourceSymbol: row.source_symbol == null ? null : String(row.source_symbol), targetSymbol: row.target_symbol == null ? null : String(row.target_symbol)
    }));

    assert.ok(rows.some(row => row.type === 'TESTS'
      && row.sourcePath === 'test/service.test.ts' && row.targetPath === 'src/service.ts' && row.provider === 'graph-derived'));
    assert.ok(rows.some(row => row.type === 'HANDLES'
      && row.sourcePath === 'src/routes.ts' && row.targetName === 'GET /api/accounts' && row.sourceSymbol === 'getAccounts'));
    assert.ok(rows.some(row => row.type === 'HTTP_CALLS'
      && row.sourcePath === 'src/client.ts' && row.targetPath === 'src/routes.ts' && row.targetSymbol === 'getAccounts'));
    assert.ok(rows.some(row => row.type === 'HTTP_CALLS'
      && row.sourcePath === 'src/client.ts' && row.targetName === 'GET https://api.example.test/api/accounts'
      && row.targetPath === 'src/routes.ts'), 'absolute HTTP URLs must canonicalize to the matching local route path');
    assert.ok(rows.some(row => row.type === 'LISTENS_ON'
      && row.sourcePath === 'src/listener.ts' && row.targetName === 'event:account:saved' && row.sourceSymbol === 'onAccountSaved'));
    assert.ok(rows.some(row => row.type === 'EMITS'
      && row.sourcePath === 'src/emitter.ts' && row.targetPath === 'src/listener.ts' && row.targetSymbol === 'onAccountSaved'));
    assert.ok(rows.some(row => row.type === 'EMITS' && row.sourcePath === 'src/generic-emitter.ts' && row.targetName === 'event:message' && row.targetPath == null),
      'generic local events may be retained as facts but must not create cross-file dependencies');

    const fakeHints = db.prepare("SELECT type, target_name FROM relation_hints rh JOIN files f ON f.id=rh.source_file_id WHERE f.path='src/noise.ts'").all();
    assert.equal(fakeHints.length, 0, 'comments and string literals must not create JS/TS relationship facts');
    const bareImport = db.prepare("SELECT target_path FROM imports i JOIN files f ON f.id=i.source_file_id WHERE f.path='src/bare-import.ts' AND i.specifier='react'").get();
    assert.equal(bareImport?.target_path ?? null, null, 'bare npm imports must not suffix-resolve to unrelated local files');
  } finally {
    db.close();
  }
} finally {
  await repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Repository graph TESTS, HTTP route/caller, and event relationship tests passed.');
