import { getCompactToolDefinitions } from './compactRegistry.js';
import { resolveToolProfile } from './profile.js';
import { LEGACY_TOOL_NAMES, TOOL_NAMES, definitionFor, definitionsFor } from './profileRegistry.js';
import { schemaFromDefinition, withWorkspaceAliases } from './schemaBuilder.js';
import { getToolGroups, getToolMetadata, getToolSurfaceManifest } from './surface.js';

const toolSchemas = getCompactToolDefinitions().map(schemaFromDefinition);
const publicToolSchemas = toolSchemas.map(({ outputSchema: _outputSchema, ...schema }) => schema);

function getToolSchemas(config = {}) {
  return withWorkspaceAliases(definitionsFor(config).map(schemaFromDefinition), config);
}

function getPublicToolSchemas(config = {}) {
  return getToolSchemas(config).map(({ outputSchema: _outputSchema, ...schema }) => schema);
}

function getToolDefinition(name, config = {}) {
  return definitionFor(name, config);
}

function getToolDefinitions(config = {}) {
  return definitionsFor(config);
}

function getToolNames(config = {}) {
  return definitionsFor(config).map(definition => definition.name);
}

function isToolCallable(name, config = {}) {
  return Boolean(definitionFor(name, config));
}

function configForProfile(profile) {
  return { toolProfile: resolveToolProfile(profile) };
}

export {
  LEGACY_TOOL_NAMES,
  TOOL_NAMES,
  configForProfile,
  getPublicToolSchemas,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups,
  getToolMetadata,
  getToolNames,
  getToolSchemas,
  getToolSurfaceManifest,
  isToolCallable,
  publicToolSchemas,
  toolSchemas
};
