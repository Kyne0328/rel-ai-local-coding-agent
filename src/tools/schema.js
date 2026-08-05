import { getCatalogToolDefinition, getCatalogToolDefinitions } from './actionCatalog.js';
import { schemaFromDefinition } from './schemaBuilder.js';
import { getToolGroups, getToolMetadata, getToolSurfaceManifest } from './surface.js';

const toolDefinitions = getCatalogToolDefinitions();
const TOOL_NAMES = Object.freeze(toolDefinitions.map(definition => definition.name));
const toolSchemas = toolDefinitions.map(schemaFromDefinition);
const publicToolSchemas = toolSchemas.map(({ outputSchema: _outputSchema, ...schema }) => schema);

function getToolSchemas() {
  return toolDefinitions.map(schemaFromDefinition);
}

function getPublicToolSchemas() {
  return getToolSchemas().map(({ outputSchema: _outputSchema, ...schema }) => schema);
}

function getToolDefinition(name) {
  return getCatalogToolDefinition(name);
}

function getToolDefinitions() {
  return toolDefinitions;
}

function getToolNames() {
  return TOOL_NAMES;
}

function isToolCallable(name) {
  return Boolean(getCatalogToolDefinition(name));
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
