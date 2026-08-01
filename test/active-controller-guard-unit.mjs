import assert from 'node:assert/strict';
import path from 'node:path';
import { discoverActiveControllers, evaluateControllerSafety, pathsOverlap } from '../scripts/active-controller-guard.mjs';

const repository = path.resolve('C:/Dev/rel-ai-mcp');
const releaseTarget = path.join(repository, 'dist');
const installedController = {
  pid: 4101,
  name: 'Rel.AI MCP.exe',
  execPath: 'C:/Program Files/Rel.AI MCP/Rel.AI MCP.exe',
  commandLine: '"C:/Program Files/Rel.AI MCP/Rel.AI MCP.exe"'
};
const unpackedController = {
  pid: 4102,
  name: 'Rel.AI MCP.exe',
  execPath: path.join(releaseTarget, 'win-unpacked', 'Rel.AI MCP.exe'),
  resourcesPath: path.join(releaseTarget, 'win-unpacked', 'resources')
};

assert.equal(pathsOverlap(path.join(releaseTarget, 'win-unpacked'), releaseTarget), true);
assert.equal(pathsOverlap(installedController.execPath, releaseTarget), false);

const safeBuild = evaluateControllerSafety({ operation: 'package', targetPaths: [releaseTarget], controllers: [installedController] });
assert.equal(safeBuild.ok, true, 'packaging may run while an installed controller outside the output tree remains active');

const blockedBuild = evaluateControllerSafety({ operation: 'package', targetPaths: [releaseTarget], controllers: [unpackedController] });
assert.equal(blockedBuild.ok, false, 'packaging must not replace files used by an active unpacked controller');
assert.equal(blockedBuild.blockingControllers[0].pid, unpackedController.pid);

const blockedInstall = evaluateControllerSafety({ operation: 'install', targetPaths: [], controllers: [installedController] });
assert.equal(blockedInstall.ok, false, 'production-identity install operations must stop when any Rel.AI controller is active');

const discovered = discoverActiveControllers({
  markers: [{ pid: 5101, execPath: path.join(releaseTarget, 'build-check', 'win-unpacked', 'Rel.AI MCP.exe') }],
  processes: [
    { ProcessId: 5101, Name: 'Rel.AI MCP.exe', ExecutablePath: path.join(releaseTarget, 'build-check', 'win-unpacked', 'Rel.AI MCP.exe') },
    { ProcessId: 5102, Name: 'node.exe', CommandLine: 'node unrelated-service.js' },
    { ProcessId: 5103, Name: 'node.exe', CommandLine: 'node C:/Dev/rel-ai-mcp/bin/rel-ai-mcp-http.js' }
  ],
  isAlive: pid => pid !== 5102
});
assert.deepEqual(discovered.map(item => item.pid), [5101, 5103]);

console.log('Active controller build and installer safety tests passed.');
