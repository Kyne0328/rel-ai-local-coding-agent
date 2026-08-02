import { getCompactToolDefinition, getCompactToolDefinitions } from './compactRegistry.js';
import { getToolDefinition as getLegacyToolDefinition, getToolDefinitions as getLegacyToolDefinitions } from './registry.js';
import { TOOL_PROFILE, profileFromConfig } from './profile.js';

const TOOL_NAMES = Object.freeze(getCompactToolDefinitions().map(definition => definition.name));
const LEGACY_TOOL_NAMES = Object.freeze(getLegacyToolDefinitions().map(definition => definition.name));

function definitionsFor(config = {}) {
  return profileFromConfig(config) === TOOL_PROFILE.LEGACY
    ? getLegacyToolDefinitions()
    : getCompactToolDefinitions();
}

function definitionFor(name, config = {}) {
  return profileFromConfig(config) === TOOL_PROFILE.LEGACY
    ? getLegacyToolDefinition(name)
    : getCompactToolDefinition(name);
}

export { LEGACY_TOOL_NAMES, TOOL_NAMES, definitionFor, definitionsFor };
