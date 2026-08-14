import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { repositoryIntelligence } from '../src/repository/intelligence/service.js';
import { TOOL_SURFACE_VERSION, getCatalogAction, getCatalogToolDefinition } from '../src/tools/actionCatalog.js';

assert.equal(TOOL_SURFACE_VERSION, 40);
const inspectDefinition = getCatalogToolDefinition('relai_inspect');
assert.ok(inspectDefinition.inputSchema.properties.action.enum.includes('architecture'));
const architectureAction = getCatalogAction('relai_inspect', { action: 'architecture' });
assert.ok(architectureAction);
assert.ok(architectureAction.fields.includes('maxResults'));
assert.ok(architectureAction.fields.includes('maxFiles'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-architecture-'));
const stateDir = path.join(root, '.state');
const workspaceRoot = path.join(root, 'workspace');
fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
fs.mkdirSync(path.join(workspaceRoot, 'electron'), { recursive: true });
fs.mkdirSync(path.join(workspaceRoot, 'test'), { recursive: true });

fs.writeFileSync(path.join(workspaceRoot, 'src', 'core.js'), `
export function coreValue() { return 1; }
`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'service.js'), `
import { coreValue } from './core.js';
export function serviceValue() { return coreValue(); }
`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'routes.js'), `
import { serviceValue } from './service.js';
export function getStatus() { return serviceValue(); }
router.get('/status', getStatus);
`);
fs.writeFileSync(path.join(workspaceRoot, 'electron', 'main.js'), `
import { serviceValue } from '../src/service.js';
export function main() { return serviceValue(); }
main();
`);
fs.writeFileSync(path.join(workspaceRoot, 'test', 'service.test.js'), `
import { serviceValue } from '../src/service.js';
serviceValue();
`);

const workspace = { alias: 'architecture-test', path: workspaceRoot, context: {}, testCommands: {}, commands: {} };
const config = { stateDir };

try {
  const result = await repositoryIntelligence.codeInspect(workspace, config, { action: 'architecture', maxResults: 20 });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'architecture');
  assert.equal(result.architecture.strategy, 'bounded-file-graph');
  assert.ok(result.modules.some(item => item.name === 'src'));
  assert.ok(result.modules.some(item => item.name === 'electron'));
  assert.ok(result.entryPoints.some(item => item.path === 'electron/main.js'));
  assert.ok(result.entryPoints.some(item => item.path === 'src/routes.js' && item.reasons.includes('routes:1')));
  assert.ok(result.hotspots.some(item => item.path === 'src/service.js'));
  assert.ok(result.layers.some(item => item.depth === 0 && item.modules.includes('src')));
  assert.ok(result.communities.length >= 1);
  assert.ok(result.relationshipTypes.IMPORTS >= 4);
  assert.ok(result.relationshipTypes.HANDLES >= 1);

  const direct = await repositoryIntelligence.architecture(workspace, config, { maxResults: 10 });
  assert.equal(direct.action, 'architecture');
  assert.equal(direct.architecture.strategy, 'bounded-file-graph');
} finally {
  repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Repository architecture action, bounded graph analysis, and tool-surface schema tests passed.');
