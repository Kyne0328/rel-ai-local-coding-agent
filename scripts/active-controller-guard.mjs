import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER_FILE = 'controller-runtime.json';
const DESTRUCTIVE_OPERATIONS = new Set(['install', 'update', 'uninstall', 'replace-production']);

function assertSafeControllerOperation(options = {}) {
  const operation = String(options.operation || 'build');
  const targetPaths = (options.targetPaths || []).map(resolvePath);
  const controllers = options.controllers || discoverActiveControllers(options);
  const result = evaluateControllerSafety({ operation, targetPaths, controllers });
  if (!result.ok) {
    const details = result.blockingControllers.map(formatController).join('\n');
    throw new Error(`${result.message}${details ? `\n${details}` : ''}`);
  }
  return result;
}

function evaluateControllerSafety({ operation = 'build', targetPaths = [], controllers = [] } = {}) {
  const active = controllers.filter(controller => Number(controller.pid) !== process.pid);
  if (DESTRUCTIVE_OPERATIONS.has(operation) && active.length) {
    return {
      ok: false,
      operation,
      blockingControllers: active,
      message: `Refusing ${operation}: an active Rel.AI controller is running. Installer and updater lifecycle operations must run only after the controller is stopped or on an isolated release machine.`
    };
  }

  const targets = targetPaths.map(resolvePath);
  const blockingControllers = active.filter(controller => targets.some(target => controllerTouchesTarget(controller, target)));
  if (blockingControllers.length) {
    return {
      ok: false,
      operation,
      blockingControllers,
      message: `Refusing ${operation}: the requested output or cleanup path contains files used by the active Rel.AI controller. Use a different build directory or stop that controller explicitly.`
    };
  }

  return { ok: true, operation, blockingControllers: [], activeControllers: active };
}

function discoverActiveControllers(options = {}) {
  const isAlive = options.isAlive || isProcessAlive;
  const markers = options.markers || readRuntimeMarkers(options.markerPaths || defaultMarkerPaths());
  const processes = options.processes || listRelAiProcesses();
  const found = new Map();

  for (const marker of markers) {
    const pid = Number(marker.pid || 0);
    if (!pid || !isAlive(pid)) continue;
    found.set(pid, normalizeController({ ...marker, source: 'runtime-marker' }));
  }

  for (const processInfo of processes) {
    const pid = Number(processInfo.pid || processInfo.ProcessId || 0);
    if (!pid || pid === process.pid || !isAlive(pid)) continue;
    const controller = normalizeController({
      pid,
      name: processInfo.name || processInfo.Name,
      execPath: processInfo.execPath || processInfo.ExecutablePath,
      commandLine: processInfo.commandLine || processInfo.CommandLine,
      source: 'process-scan'
    });
    if (!looksLikeRelAiController(controller)) continue;
    found.set(pid, { ...controller, ...(found.get(pid) || {}) });
  }

  return [...found.values()].sort((left, right) => left.pid - right.pid);
}

function defaultMarkerPaths() {
  const stateDirs = new Set([
    process.env.REL_AI_MCP_STATE_DIR,
    path.join(os.homedir(), '.rel-ai-mcp')
  ].filter(Boolean).map(resolvePath));
  return [...stateDirs].map(directory => path.join(directory, MARKER_FILE));
}

function readRuntimeMarkers(markerPaths) {
  const markers = [];
  for (const markerPath of markerPaths) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker && typeof marker === 'object') markers.push({ ...marker, markerPath });
    } catch {}
  }
  return markers;
}

function listRelAiProcesses() {
  if (process.platform === 'win32') return listWindowsProcesses();
  return listPosixProcesses();
}

function listWindowsProcesses() {
  const command = [
    "$items = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Rel.AI MCP.exe','electron.exe','node.exe') }",
    '$items | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress'
  ].join('; ');
  for (const shell of ['powershell.exe', 'pwsh']) {
    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000
    });
    if (result.status !== 0 || !String(result.stdout || '').trim()) continue;
    try {
      const parsed = JSON.parse(result.stdout);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }
  return [];
}

function listPosixProcesses() {
  const result = spawnSync('ps', ['-eo', 'pid=,comm=,args='], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) return [];
  return String(result.stdout || '').split(/\r?\n/).map(line => {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s*(.*)$/);
    return match ? { pid: Number(match[1]), name: match[2], commandLine: match[3] } : null;
  }).filter(Boolean);
}

function controllerTouchesTarget(controller, target) {
  const fields = [controller.execPath, controller.resourcesPath, controller.appPath, controller.cwd].filter(Boolean);
  if (fields.some(value => pathsOverlap(value, target))) return true;
  const commandLine = normalizeText(controller.commandLine);
  const normalizedTarget = normalizeText(resolvePath(target));
  return Boolean(commandLine && normalizedTarget && commandLine.includes(normalizedTarget));
}

function pathsOverlap(left, right) {
  const a = normalizeText(resolvePath(left));
  const b = normalizeText(resolvePath(right));
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function looksLikeRelAiController(controller) {
  const name = normalizeText(controller.name);
  const haystack = normalizeText([controller.name, controller.execPath, controller.commandLine, controller.appPath, controller.resourcesPath].filter(Boolean).join(' '));
  return name === 'rel.ai mcp.exe' || haystack.includes('rel-ai-mcp') || haystack.includes('rel.ai mcp');
}

function normalizeController(value = {}) {
  return {
    pid: Number(value.pid || 0),
    name: String(value.name || ''),
    execPath: stringOrEmpty(value.execPath),
    resourcesPath: stringOrEmpty(value.resourcesPath),
    appPath: stringOrEmpty(value.appPath),
    cwd: stringOrEmpty(value.cwd),
    commandLine: stringOrEmpty(value.commandLine),
    version: stringOrEmpty(value.version),
    packaged: value.packaged === true,
    source: stringOrEmpty(value.source),
    markerPath: stringOrEmpty(value.markerPath)
  };
}

function formatController(controller) {
  const location = controller.execPath || controller.appPath || controller.commandLine || 'unknown path';
  return `- PID ${controller.pid}: ${location}`;
}

function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(value) {
  return path.resolve(root, String(value || '.'));
}

function normalizeText(value) {
  return String(value || '').trim().replaceAll('\\', '/').toLowerCase();
}

function stringOrEmpty(value) {
  return value == null ? '' : String(value);
}

function parseCliArgs(argv) {
  const options = { operation: 'build', targetPaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--operation') options.operation = String(argv[++index] || 'build');
    else if (value === '--target') options.targetPaths.push(String(argv[++index] || ''));
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = assertSafeControllerOperation(parseCliArgs(process.argv.slice(2)));
    console.log(`Active controller guard passed for ${result.operation}.`);
  } catch (error) {
    console.error(`[active-controller-guard] ${error.message}`);
    process.exit(1);
  }
}

export {
  MARKER_FILE,
  assertSafeControllerOperation,
  controllerTouchesTarget,
  defaultMarkerPaths,
  discoverActiveControllers,
  evaluateControllerSafety,
  pathsOverlap,
  readRuntimeMarkers
};
