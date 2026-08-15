import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER_FILE = 'controller-runtime.json';

function controllerRuntimeMarkerPath() {
  const stateDir = process.env.REL_AI_MCP_STATE_DIR || path.join(os.homedir(), '.rel-ai-mcp');
  return path.join(path.resolve(stateDir), MARKER_FILE);
}

async function writeControllerRuntimeMarker(app) {
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
  await fs.promises.mkdir(path.dirname(markerPath), { recursive: true, mode: 0o700 });
  const temporary = `${markerPath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.rm(markerPath, { force: true });
  await fs.promises.rename(temporary, markerPath);
  return marker;
}

async function removeControllerRuntimeMarker() {
  const markerPath = controllerRuntimeMarkerPath();
  try {
    const marker = JSON.parse(await fs.promises.readFile(markerPath, 'utf8'));
    if (Number(marker.pid || 0) !== process.pid) return false;
    await fs.promises.rm(markerPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export { removeControllerRuntimeMarker, writeControllerRuntimeMarker };
