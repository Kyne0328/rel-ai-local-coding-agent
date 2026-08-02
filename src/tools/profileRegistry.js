import { getCompactToolDefinition, getCompactToolDefinitions } from './compactRegistry.js';
import { TOOL_PROFILE, profileFromConfig } from './profile.js';

const COMPACT_DEFINITIONS = getCompactToolDefinitions();
const CORE_EXCLUDED_TOOLS = new Set(['relai_snapshot', 'relai_process', 'relai_worktree', 'relai_changes', 'relai_publish']);
const CORE_DEFINITIONS = Object.freeze(COMPACT_DEFINITIONS.filter(definition => !CORE_EXCLUDED_TOOLS.has(definition.name)));
const TOOL_NAMES = Object.freeze(COMPACT_DEFINITIONS.map(definition => definition.name));
const CORE_TOOL_NAMES = Object.freeze(CORE_DEFINITIONS.map(definition => definition.name));

function definitionsFor(config = {}) {
  const profile = profileFromConfig(config);
  return profile === TOOL_PROFILE.CORE ? CORE_DEFINITIONS : COMPACT_DEFINITIONS;
}

function definitionFor(name, config = {}) {
  const profile = profileFromConfig(config);
  if (profile === TOOL_PROFILE.CORE && !CORE_TOOL_NAMES.includes(String(name || ''))) return null;
  return getCompactToolDefinition(name);
}

export { CORE_TOOL_NAMES, TOOL_NAMES, definitionFor, definitionsFor };
