const WORKSPACE_CONFIG_PATHS = new Set(['.relaiignore', 'package.json']);
const WORKSPACE_CONFIG_PREFIXES = ['.github/', '.rel-ai-mcp/'];

function isWorkspaceConfigPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) return false;
  const normalized = relativePath.replaceAll('\\', '/');
  if (WORKSPACE_CONFIG_PATHS.has(normalized)) return true;
  return WORKSPACE_CONFIG_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function classifyCaution(toolName, args) {
  if (toolName === 'relai_write' || toolName === 'relai_replace' || toolName === 'relai_edit') {
    if (typeof args?.path === 'string' && isWorkspaceConfigPath(args.path)) {
      return { level: 'caution', reason: 'workspace config path modified' };
    }
  }
  return { level: null, reason: null };
}

module.exports = { classifyCaution };
