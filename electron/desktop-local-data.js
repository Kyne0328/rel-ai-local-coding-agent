import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_SCANNED_ENTRIES = 200_000;

function createDesktopLocalDataManager(options = {}) {
  const {
    getConfig,
    getServiceLogPath = () => '',
    getTaskActivity = () => ({}),
    openPath = async () => ''
  } = options;
  if (typeof getConfig !== 'function') throw new TypeError('getConfig is required.');

  async function getUsage() {
    const config = getConfig();
    const configuredStateDir = String(config?.stateDir || '').trim();
    if (!configuredStateDir) throw new Error('Rel.AI local data folder is unavailable.');
    const stateDir = path.resolve(configuredStateDir);
    const auditPath = path.resolve(String(config?.auditLogPath || path.join(stateDir, 'audit.jsonl')));
    const paths = {
      history: [path.join(stateDir, 'sessions'), auditPath, `${auditPath}.1`],
      logs: [String(getServiceLogPath() || '')].filter(Boolean),
      temporary: [path.join(stateDir, 'output-spills')],
      indexes: [path.join(stateDir, 'repository-intelligence')]
    };
    const [history, logs, temporary, indexes] = await Promise.all(
      Object.values(paths).map(targets => measurePaths(targets))
    );
    const categories = { history, logs, temporary, indexes };
    return {
      ok: true,
      totalBytes: Object.values(categories).reduce((sum, item) => sum + item.bytes, 0),
      categories,
      activeTaskCount: activeTaskCount(getTaskActivity()),
      approximate: Object.values(categories).some(item => item.truncated)
    };
  }

  async function clearTemporary() {
    const active = activeTaskCount(getTaskActivity());
    if (active > 0) {
      return {
        ok: false,
        error: `Cannot clear temporary command output while ${active} Rel.AI ${active === 1 ? 'task is' : 'tasks are'} still active.`
      };
    }
    const config = getConfig();
    const configuredStateDir = String(config?.stateDir || '').trim();
    if (!configuredStateDir) return { ok: false, error: 'Rel.AI local data folder is unavailable.' };
    const stateDir = path.resolve(configuredStateDir);
    await fs.promises.rm(path.join(stateDir, 'output-spills'), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    return getUsage();
  }

  async function openDataFolder() {
    const config = getConfig();
    const configuredStateDir = String(config?.stateDir || '').trim();
    if (!configuredStateDir) return { ok: false, error: 'Rel.AI local data folder is unavailable.' };
    const stateDir = path.resolve(configuredStateDir);
    await fs.promises.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const error = await openPath(stateDir);
    return error ? { ok: false, error: String(error) } : { ok: true };
  }

  return { getUsage, clearTemporary, openDataFolder };
}

async function measurePaths(targets) {
  let bytes = 0;
  let entries = 0;
  let truncated = false;
  const queue = [...new Set(targets.filter(Boolean))];
  while (queue.length) {
    const target = queue.pop();
    let stat;
    try { stat = await fs.promises.lstat(target); } catch { continue; }
    entries += 1;
    if (entries > MAX_SCANNED_ENTRIES) {
      truncated = true;
      break;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile()) {
      bytes += Math.max(0, Number(stat.size || 0));
      continue;
    }
    if (!stat.isDirectory()) continue;
    let children;
    try { children = await fs.promises.readdir(target); } catch { continue; }
    for (const child of children) queue.push(path.join(target, child));
  }
  return { bytes, entries, truncated };
}

function activeTaskCount(activity = {}) {
  const count = Number(activity?.activeTaskCount || 0);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export { createDesktopLocalDataManager };
