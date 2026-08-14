import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCatalogTools, getToolActionCatalog, TOOL_SURFACE_VERSION } from '../src/tools/actionCatalog.js';
import * as nativeToolTasks from '../src/mcp/nativeToolTasks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.equal(getCatalogTools().length, 15);
assert.equal(getToolActionCatalog().length, 52);
assert.equal(Number.isInteger(TOOL_SURFACE_VERSION), true);

const sourceFiles = collectJavaScript(path.join(root, 'src'));
const surfaceDeclarations = sourceFiles.filter(file => /const TOOL_SURFACE_VERSION\s*=/.test(fs.readFileSync(file, 'utf8')));
assert.deepEqual(surfaceDeclarations.map(file => path.relative(root, file).replaceAll('\\', '/')), ['src/tools/actionCatalog.js']);

const actionDefinitionsPath = path.join(root, 'src/tools/actionDefinitions.js');
assert.equal(fs.existsSync(actionDefinitionsPath), true, 'immutable tool definitions must have a focused owner');
const actionCatalogSource = read('src/tools/actionCatalog.js');
const actionDefinitionsSource = read('src/tools/actionDefinitions.js');
assert.equal(actionCatalogSource.split(/\r?\n/).length <= 400, true, 'action catalog resolution must remain bounded');
const operationDefinitionValuesSource = read('src/tools/operationDefinitionValues.js');
assert.match(actionDefinitionsSource, /from '.\/operationDefinitionValues\.js'/);
assert.match(operationDefinitionValuesSource, /const OPERATION_DEFINITION_VALUES\s*=/);
assert.match(actionDefinitionsSource, /const PUBLIC_DEFINITION_VALUES\s*=/);
assert.doesNotMatch(actionCatalogSource, /const OPERATION_DEFINITION_VALUES\s*=/);
assert.doesNotMatch(actionCatalogSource, /const PUBLIC_DEFINITION_VALUES\s*=/);

for (const removed of [
  'src/tools/compactRegistry.js',
  'src/tools/registry.js',
  'src/tools/dispatch.js',
  'src/operationTasks.js'
]) assert.equal(fs.existsSync(path.join(root, removed)), false, `${removed} must remain removed`);

assert.deepEqual(Object.keys(nativeToolTasks).sort(), [
  'completeNativeToolTask',
  'createNativeToolTask',
  'failNativeToolTask',
  'nativeToolTaskSignal',
  'pruneNativeToolTasks'
]);
const nativeToolTaskSource = read('src/mcp/nativeToolTasks.js');
assert.doesNotMatch(nativeToolTaskSource, /compatibilityOperation\s*:/, 'new native tool tasks must not write the compatibility field');

const runtimeRegistry = read('src/tools/runtimeRegistry.js');
assert.match(runtimeRegistry, /Executable-only function map retained to avoid/);
assert.doesNotMatch(runtimeRegistry, /TOOL_SURFACE_VERSION|inputSchema\s*:/, 'the executable map must not become a second metadata source');

const ipc = read('electron/ipc-handlers.js');
for (const name of [
  'registerSetupIpc',
  'registerRecoveryIpc',
  'registerServiceIpc',
  'registerDashboardWindowIpc',
  'registerDesktopSettingsIpc',
  'registerUpdaterIpc',
  'registerDiagnosticsIpc',
  'registerSharedUtilityIpc'
]) assert.match(ipc, new RegExp(`function ${name}\\(\\{`), `${name} must receive a narrow capability object`);

for (const [file, expectedImport] of [
  ['src/worktreeManager.js', "from './durableState.js'"],
  ['src/mcp/connectionGenerations.js', "from '../durableState.js'"]
]) {
  const source = read(file);
  assert.match(source, new RegExp(expectedImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /fs\.writeFileSync|fs\.renameSync/, `${file} must use durable state promotion`);
}

const transport = read('src/http/mcpTransport.js');
assert.match(transport, /async function handleLegacyMcpRequest\s*\(/);
assert.match(transport, /if \(legacy\) \{\s*await handleLegacyMcpRequest/);

const architecture = read('docs/ARCHITECTURE.md');
for (const heading of [
  '## Composition roots',
  '## Canonical tool and action catalog',
  '## Native MCP Tasks',
  '## Task-state authorities and projections',
  '## Electron ownership and IPC',
  '## Durable persistence',
  '## Compatibility exceptions',
  '## Current architecture metrics'
]) assert.match(architecture, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

console.log('Final architecture ownership, metrics, residue, and documented exception contracts passed.');

function collectJavaScript(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScript(target));
    else if (entry.name.endsWith('.js')) files.push(target);
  }
  return files;
}
