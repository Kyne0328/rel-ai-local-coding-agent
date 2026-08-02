import { getCompactToolDefinition, getCompactToolDefinitions } from './compactRegistry.js';
import { schemaFromDefinition, withWorkspaceAliases } from './schemaBuilder.js';
import { getToolGroups, getToolMetadata, getToolSurfaceManifest } from './surface.js';

const toolDefinitions = getCompactToolDefinitions();
const TOOL_NAMES = Object.freeze(toolDefinitions.map(definition => definition.name));
const toolSchemas = toolDefinitions.map(schemaFromDefinition);
const publicToolSchemas = toolSchemas.map(({ outputSchema: _outputSchema, ...schema }) => schema);

function getToolSchemas(config = {}) {
  return withWorkspaceAliases(toolDefinitions.map(schemaFromDefinition), config);
}

function getPublicToolSchemas(config = {}) {
  return getToolSchemas(config).map(({ outputSchema: _outputSchema, ...schema }) => schema);
}

function getToolDefinition(name) {
  return getCompactToolDefinition(name);
}

function getToolDefinitions() {
  return toolDefinitions;
}

function getToolNames() {
  return TOOL_NAMES;
}

function isToolCallable(name) {
  return Boolean(getCompactToolDefinition(name));
}

export {
  TOOL_NAMES,
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
