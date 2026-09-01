import { getCatalogToolDefinition, getCatalogToolDefinitions, getCatalogTools } from './actionCatalog.js';
import { executableInputSchema } from './executableSchema.js';
import { getToolGroups, getToolMetadata, getToolSurfaceManifest } from './surface.js';
import { compactPublicInputSchema } from './publicSchema.js';
import { toolUiMetadata } from '../mcp/appUi.js';
import { LOCAL_DEVELOPER_SECURITY_SCHEMES, LOCAL_DEVELOPER_TOOL_ANNOTATIONS } from '../mcp/localDeveloperMode.js';
const toolDefinitions = getCatalogToolDefinitions();
const catalogToolByName = new Map(getCatalogTools().map(tool => [tool.definition.name, tool]));
const TOOL_NAMES = Object.freeze(toolDefinitions.map(definition => definition.name));
const PUBLIC_DISCOVERY_OUTPUT_FIELDS = Object.freeze(['ok', 'workspace', 'work_id', 'message', 'error', 'errorCode', 'nextAction']);
// Keep schema object identity stable for the lifetime of the process. The MCP SDK
// caches JSON-schema adapters by object identity, so rebuilding equivalent objects
// on every stateless request defeats that cache and adds tens of milliseconds.
const toolSchemas = Object.freeze(toolDefinitions.map(definition => Object.freeze(buildToolSchema(definition))));
const publicToolSchemas = Object.freeze(toolDefinitions.map(definition => Object.freeze(buildPublicToolSchema(definition))));
const mcpToolSchemas = publicToolSchemas;

function getToolSchemas() {
  return toolSchemas;
}

function getPublicToolSchemas() {
  return publicToolSchemas;
}

function getMcpToolSchemas() {
  return mcpToolSchemas;
}

function buildPublicToolSchema(definition) {
  const schema = buildToolSchema(definition);
  const uiMetadata = toolUiMetadata(schema.name);
  const meta = Object.freeze({
    securitySchemes: LOCAL_DEVELOPER_SECURITY_SCHEMES,
    ...(uiMetadata || {}),
    ...(schema.name === 'relai_edit' ? { 'openai/fileParams': ['file'] } : {})
  });
  return {
    ...schema,
    annotations: LOCAL_DEVELOPER_TOOL_ANNOTATIONS,
    _meta: meta,
    inputSchema: compactPublicInputSchema(schema.name, schema.inputSchema, catalogToolByName.get(schema.name)),
    outputSchema: compactPublicOutputSchema(schema.outputSchema)
  };
}

function buildToolSchema(definition) {
  const catalogTool = catalogToolByName.get(definition.name);
  const schema = {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: executableInputSchema(definition, catalogTool),
    outputSchema: definition.outputSchema,
    annotations: definition.annotations
  };
  if (!catalogTool?.actions?.length) return schema;
  return { ...schema, outputSchema: publicOutputSchema(catalogTool.actions) };
}

function compactPublicOutputSchema(schema) {
  const properties = {};
  for (const name of PUBLIC_DISCOVERY_OUTPUT_FIELDS) {
    if (schema?.properties?.[name]) properties[name] = schema.properties[name];
  }
  return {
    type: 'object',
    properties,
    required: ['ok'],
    additionalProperties: true
  };
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
  getMcpToolSchemas,
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
