const WORKSPACE_CONFIG_PATHS = new Set(['.relaiignore', 'package.json']);
const WORKSPACE_CONFIG_PREFIXES = ['.github/', '.rel-ai-mcp/'];

function isWorkspaceConfigPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) return false;
  const normalized = relativePath.replaceAll('\\', '/');
  if (WORKSPACE_CONFIG_PATHS.has(normalized)) return true;
  return WORKSPACE_CONFIG_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function classifyCaution(toolName, args) {
  if (toolName === 'relai_exec') {
    const command = String(args?.command || '');
    if (/\b(?:git\s+(?:reset\s+--hard|clean\s+-[^\s]*f)|rm\s+-rf|rmdir\s+\/s|drop\s+(?:database|table)|docker\s+system\s+prune)\b/i.test(command)) {
      return { level: 'caution', reason: 'workspace command contains a destructive operation' };
    }
  }
  if (toolName === 'relai_edit') {
    if (typeof args?.path === 'string' && isWorkspaceConfigPath(args.path)) {
      return { level: 'caution', reason: 'workspace config path modified' };
    }
  }
  return { level: null, reason: null };
}

export { classifyCaution };
