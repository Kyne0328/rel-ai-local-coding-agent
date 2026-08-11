import { getCatalogToolDefinition, getCatalogToolDefinitions, getCatalogTools } from './actionCatalog.js';
import { schemaFromDefinition } from './schemaBuilder.js';
import { getToolGroups, getToolMetadata, getToolSurfaceManifest } from './surface.js';

const toolDefinitions = getCatalogToolDefinitions();
const catalogToolByName = new Map(getCatalogTools().map(tool => [tool.definition.name, tool]));
const TOOL_NAMES = Object.freeze(toolDefinitions.map(definition => definition.name));
const toolSchemas = toolDefinitions.map(buildToolSchema);

function getToolSchemas() {
  return toolDefinitions.map(buildToolSchema);
}

function getPublicToolSchemas() {
  return getToolSchemas();
}

function buildToolSchema(definition) {
  const schema = schemaFromDefinition(definition);
  const catalogTool = catalogToolByName.get(definition.name);
  if (!catalogTool?.actions?.length) return schema;
  return { ...schema, outputSchema: publicOutputSchema(catalogTool.actions) };
}

function publicOutputSchema(actions) {
  const properties = {};
  for (const action of actions) collectOutputProperties(action.outputSchema, properties);
  return {
    type: 'object',
    properties,
    required: ['ok'],
    additionalProperties: false
  };
}

function collectOutputProperties(schema, target) {
  if (!schema || typeof schema !== 'object') return;
  for (const [name, fieldSchema] of Object.entries(schema.properties || {})) {
    if (!Object.hasOwn(target, name)) target[name] = fieldSchema;
  }
  for (const keyword of ['oneOf', 'anyOf', 'allOf']) {
    for (const branch of schema[keyword] || []) collectOutputProperties(branch, target);
  }
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
  getToolDefinitions,
  getToolGroups,
  getToolMetadata,
  getToolNames,
  getToolSchemas,
  getToolSurfaceManifest,
  isToolCallable,
  toolSchemas
};
