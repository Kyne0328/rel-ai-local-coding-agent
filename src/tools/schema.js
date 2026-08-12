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
  return toolDefinitions.map(buildPublicToolSchema);
}

function buildPublicToolSchema(definition) {
  const schema = buildToolSchema(definition);
  return {
    ...schema,
    inputSchema: compactPublicInputSchema(schema.name, schema.inputSchema),
    outputSchema: compactPublicOutputSchema(schema.name, schema.outputSchema)
  };
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

const PUBLIC_INPUT_DESCRIPTIONS = Object.freeze({
  relai_exec: new Set([
    'description',
    'properties.command.description',
    'properties.executable.description',
    'properties.argv.description',
    'properties.input.description'
  ])
});

function compactPublicInputSchema(name, inputSchema) {
  const { allOf: _runtimeGuards, ...schema } = inputSchema || {};
  return stripPublicDescriptions(schema, PUBLIC_INPUT_DESCRIPTIONS[name] || new Set());
}

function stripPublicDescriptions(value, retained, path = '') {
  if (Array.isArray(value)) return value.map(item => stripPublicDescriptions(item, retained, path));
  if (!value || typeof value !== 'object') return value;
  const compact = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'description' && !retained.has(childPath)) continue;
    compact[key] = stripPublicDescriptions(child, retained, childPath);
  }
  return compact;
}

function compactPublicOutputSchema(name, outputSchema) {
  const keys = Object.keys(outputSchema?.properties || {});
  const properties = { ok: { type: 'boolean' } };
  if (name === 'relai_search') {
    properties.neuralEmbeddings = { type: 'boolean' };
    properties.originalBytes = { type: 'number' };
  }
  return {
    type: 'object',
    properties,
    patternProperties: { [`^(?:${keys.map(escapeRegex).join('|')})$`]: {} },
    required: ['ok'],
    additionalProperties: false
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
