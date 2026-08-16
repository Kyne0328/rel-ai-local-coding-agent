import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCatalogTools, getToolActionCatalog, TOOL_SURFACE_VERSION } from '../src/tools/actionCatalog.js';
import * as nativeToolTasks from '../src/mcp/nativeToolTasks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const catalogTools = getCatalogTools();
const catalogActions = getToolActionCatalog();
assert.ok(catalogTools.length > 0, 'the public tool catalog must not be empty');
assert.ok(catalogActions.length >= catalogTools.length, 'every public tool must resolve to at least one operation');
assert.equal(new Set(catalogTools.map(tool => tool.definition.name)).size, catalogTools.length, 'public tool names must remain unique');
assert.equal(new Set(catalogActions.map(entry => `${entry.publicTool}:${entry.action}`)).size, catalogActions.length, 'public tool/action keys must remain unique');
assert.ok(Number.isSafeInteger(TOOL_SURFACE_VERSION) && TOOL_SURFACE_VERSION > 0, 'tool-surface revisions must remain positive integers');

const sourceFiles = collectJavaScript(path.join(root, 'src'));
const surfaceDeclarations = sourceFiles.filter(file => /const TOOL_SURFACE_VERSION\s*=/.test(fs.readFileSync(file, 'utf8')));
assert.equal(surfaceDeclarations.length, 1, 'tool-surface revision must have one source of truth');

const actionDefinitionsPath = path.join(root, 'src/tools/actionDefinitions.js');
assert.equal(fs.existsSync(actionDefinitionsPath), true, 'canonical tool definitions must have a focused owner');
assert.match(read('src/tools/actionCatalog.js'), /from '.\/actionDefinitions\.js'/, 'the action catalog must consume canonical definitions instead of duplicating them');

for (const removed of [
  'src/tools/compactRegistry.js',
  'src/tools/registry.js',
  'src/tools/dispatch.js',
  'src/bridge/browser.js',
  'src/operationTasks.js',
  'src/worktreeManager.js',
  'src/parallelTaskSandbox.js'
]) assert.equal(fs.existsSync(path.join(root, removed)), false, `${removed} must remain removed`);

for (const required of [
  'completeNativeToolTask',
  'createNativeToolTask',
  'failNativeToolTask',
  'nativeToolTaskSignal',
  'pruneNativeToolTasks'
]) assert.equal(typeof nativeToolTasks[required], 'function', `${required} must remain available`);
assert.doesNotMatch(read('src/mcp/nativeToolTasks.js'), /compatibilityOperation\s*:/, 'new native tool tasks must not write the removed compatibility field');

const runtimeRegistry = read('src/tools/runtimeRegistry.js');
assert.doesNotMatch(runtimeRegistry, /TOOL_SURFACE_VERSION|inputSchema\s*:/, 'the executable map must not become a second public-metadata source');

const connectionGenerations = read('src/mcp/connectionGenerations.js');
assert.doesNotMatch(connectionGenerations, /fs\.writeFileSync|fs\.renameSync/, 'connection generations must keep durable-state persistence instead of ad hoc file replacement');

const validationPlan = read('src/bridge/validationPlan.js');
assert.match(validationPlan, /writeJsonAtomic/, 'validation plans must use shared durable-state persistence');
assert.doesNotMatch(validationPlan, /fs\.writeFileSync|fs\.renameSync/, 'validation plans must not reimplement atomic JSON persistence');

const tidy = read('src/bridge/tidy.js');
assert.match(tidy, /writeJsonAtomic/, 'tidy plans must use shared durable-state persistence');
assert.doesNotMatch(tidy, /fs\.writeFileSync/, 'tidy plans must not reimplement JSON persistence');

const workflowIntent = read('src/workflow/intent.js');
assert.match(workflowIntent, /WORKFLOW_INTENTS.*from '.\/contracts\.js'/, 'workflow intent normalization must consume the canonical workflow intent contract');
assert.doesNotMatch(workflowIntent, /const TASK_INTENTS\s*=/, 'workflow intents must have one source of truth');

console.log('Architecture ownership and stale-code invariants passed.');

function collectJavaScript(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScript(target));
    else if (entry.isFile() && /\.js$/i.test(entry.name)) files.push(target);
  }
  return files;
}
