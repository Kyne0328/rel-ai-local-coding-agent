import { z } from 'zod';
import { getCatalogToolDefinition, getCatalogToolDefinitions, getCatalogTools } from './actionCatalog.js';
import { getToolGroups, getToolMetadata, getToolSurfaceManifest } from './surface.js';
import { compactPublicInputSchema, compactPublicOutputSchema } from './publicSchema.js';

const WORK_ID_SCHEMA = zodJsonSchema(
  z.string().min(1).max(200).describe('Opaque ID returned when a repository work session begins.')
);
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

function executableInputSchema(definition, catalogTool) {
  const taskScope = definition.behavior?.taskScope || 'required';
  const properties = { ...(definition.inputSchema?.properties || {}) };
  if (taskScope !== 'none') properties.work_id = WORK_ID_SCHEMA;
  const required = [...(definition.inputSchema?.required || [])];
  if (taskScope === 'required') {
    removeValue(required, 'workspace');
    if (!required.includes('work_id')) required.push('work_id');
  }
  const branches = Array.isArray(definition.inputSchema?.oneOf)
    ? definition.inputSchema.oneOf.map(branch => executableActionBranch(branch, catalogTool, taskScope))
    : undefined;
  return {
    ...definition.inputSchema,
    properties,
    required,
    ...(branches ? { oneOf: branches } : {})
  };
}

function executableActionBranch(branch, catalogTool, fallbackTaskScope) {
  const action = String(branch?.properties?.action?.const || '');
  const entry = catalogTool?.actions?.find(item => item.action === action);
  const taskScope = entry?.behavior?.taskScope || fallbackTaskScope;
  if (taskScope === 'none') return branch;
  const properties = { ...(branch.properties || {}), work_id: WORK_ID_SCHEMA };
  const required = [...(branch.required || [])];
  if (taskScope === 'required') {
    removeValue(required, 'workspace');
    if (!required.includes('work_id')) required.push('work_id');
  }
  return { ...branch, properties, required };
}

function removeValue(values, value) {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

function zodJsonSchema(schema) {
  const { $schema: _schema, ...jsonSchema } = z.toJSONSchema(schema);
  return Object.freeze(jsonSchema);
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
