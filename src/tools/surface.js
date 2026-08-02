import { TOOL_SURFACE_VERSION } from './compactRegistry.js';
import { LEGACY_TO_COMPACT } from './dispatch.js';
import { TOOL_PROFILE, profileFromConfig } from './profile.js';
import { definitionsFor } from './profileRegistry.js';
import { schemaFromDefinition } from './schemaBuilder.js';

function getToolMetadata(config = {}) {
  return definitionsFor(config).map(definition => ({
    name: definition.name,
    title: definition.title || definition.name,
    displayName: definition.name.replace(/^relai_/, '').replaceAll('_', ' '),
    description: definition.description || '',
    category: definition.dashboard?.category || 'Workspace tools',
    requiredProfile: definition.dashboard?.requiredProfile || 'workspace',
    requiresApproval: definition.dashboard?.requiresApproval === true,
    state: definition.lifecycle?.state || 'active',
    replacements: definition.lifecycle?.replacements || (definition.lifecycle?.replacement ? [definition.lifecycle.replacement] : []),
    parameters: Object.keys(schemaFromDefinition(definition).inputSchema.properties || {}),
    outputFields: Object.keys(definition.outputSchema?.properties || {}),
    longRunning: definition.behavior?.longRunning === true,
    taskScope: definition.behavior?.taskScope || 'required',
    executionClass: definition.behavior?.executionClass || 'bounded_synchronous',
    taskSupport: definition.execution?.taskSupport || 'forbidden'
  }));
}

function getToolSurfaceManifest(config = {}) {
  const profile = profileFromConfig(config);
  const tools = definitionsFor(config).map(definition => ({
    name: definition.name,
    state: definition.lifecycle?.state || 'active',
    executionClass: definition.behavior?.executionClass || 'bounded_synchronous',
    taskSupport: definition.execution?.taskSupport || 'forbidden'
  }));
  return {
    schemaVersion: 2,
    toolSurfaceVersion: TOOL_SURFACE_VERSION,
    profile,
    toolCount: tools.length,
    tools,
    deprecations: profile === TOOL_PROFILE.LEGACY
      ? tools.map(tool => ({ ...tool, state: 'deprecated', note: 'Transitional migration profile.' }))
      : [],
    compatibilityAliases: {},
    migration: profile === TOOL_PROFILE.COMPACT ? LEGACY_TO_COMPACT : {}
  };
}

function getToolGroups(config = {}) {
  const definitions = definitionsFor(config);
  const groups = { workspace: definitions.map(definition => definition.name), git: [], audit: [], cleanup: [] };
  for (const definition of definitions) {
    for (const group of definition.groups || []) {
      if (!groups[group]) groups[group] = [];
      groups[group].push(definition.name);
    }
  }
  return groups;
}

export { getToolGroups, getToolMetadata, getToolSurfaceManifest };
