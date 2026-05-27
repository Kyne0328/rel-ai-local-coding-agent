function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function collectClearPaths(args) {
  const out = [];
  if (args && typeof args.path === 'string' && args.path) out.push(args.path);
  if (args && Array.isArray(args.paths)) for (const p of args.paths) if (typeof p === 'string' && p) out.push(p);
  return out;
}

function countUpdateFiles(args, value) {
  if (value && Array.isArray(value.touchedPaths)) return value.touchedPaths.length;
  if (value && Array.isArray(value.changedFiles)) return value.changedFiles.length;
  if (args && Array.isArray(args.touchedPaths)) return args.touchedPaths.length;
  return 0;
}

function countUpdateBytes(args, value) {
  if (value && Number.isFinite(value.patchBytes)) return value.patchBytes;
  const patch = args && (args.patch || args.diff || args.updateText);
  if (typeof patch === 'string') return Buffer.byteLength(patch, 'utf8');
  return 0;
}

const WORKSPACE_CONFIG_PATHS = ['.relaiignore', 'package.json'];
const WORKSPACE_CONFIG_PREFIXES = ['.github/', '.rel-ai-mcp/'];

function isWorkspaceConfigPath(relPath) {
  if (typeof relPath !== 'string' || !relPath) return false;
  const normalized = relPath.replace(/\\/g, '/');
  if (WORKSPACE_CONFIG_PATHS.includes(normalized)) return true;
  for (const prefix of WORKSPACE_CONFIG_PREFIXES) if (normalized.startsWith(prefix)) return true;
  return false;
}

function classifyCaution(toolName, args, value, config) {
  const cfg = (config && config.cautionZone) || {};
  const massClearThreshold = num(cfg.massClearThreshold, 3);
  const bundleFileThreshold = num(cfg.bundleFileThreshold, 5);
  const bundleBytesThreshold = num(cfg.bundleBytesThreshold, 102400);

  if (toolName === 'relai_clear_files') {
    const paths = collectClearPaths(args);
    if (paths.length >= massClearThreshold) {
      return { level: 'caution', reason: `cleared ${paths.length} files in one operation` };
    }
  }

  if (toolName === 'relai_apply_bundle') {
    return { level: 'caution', reason: 'applied prepared bundle' };
  }

  if (toolName === 'relai_apply_update') {
    const fileCount = countUpdateFiles(args, value);
    if (fileCount >= bundleFileThreshold) {
      return { level: 'caution', reason: `applied update touching ${fileCount} files` };
    }
    const byteCount = countUpdateBytes(args, value);
    if (byteCount >= bundleBytesThreshold) {
      return { level: 'caution', reason: `applied update of ${byteCount} bytes` };
    }
  }

  if (toolName === 'relai_write' || toolName === 'relai_replace' || toolName === 'relai_edit') {
    if (args && typeof args.path === 'string' && isWorkspaceConfigPath(args.path)) {
      return { level: 'caution', reason: 'workspace config path modified' };
    }
  }

  return { level: null, reason: null };
}

module.exports = { classifyCaution };
