import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER_FILE = 'controller-runtime.json';

function controllerRuntimeMarkerPath() {
  const stateDir = process.env.REL_AI_MCP_STATE_DIR || path.join(os.homedir(), '.rel-ai-mcp');
  return path.join(path.resolve(stateDir), MARKER_FILE);
}

function writeControllerRuntimeMarker(app) {
  const markerPath = controllerRuntimeMarkerPath();
  const marker = {
    schemaVersion: 1,
    pid: process.pid,
    version: String(app.getVersion() || ''),
    packaged: app.isPackaged === true,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath || '',
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    startedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(markerPath), { recursive: true, mode: 0o700 });
  const temporary = `${markerPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, markerPath);
  return marker;
}

function removeControllerRuntimeMarker() {
  const markerPath = controllerRuntimeMarkerPath();
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (Number(marker.pid || 0) !== process.pid) return false;
    fs.rmSync(markerPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export { MARKER_FILE, controllerRuntimeMarkerPath, removeControllerRuntimeMarker, writeControllerRuntimeMarker };
