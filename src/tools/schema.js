// @ts-check


/** @typedef {import('../../types/boundaries.d.ts').ToolDefinitionMetadata} ToolDefinitionMetadata */
/** @typedef {import('../../types/boundaries.d.ts').ToolSchema} ToolSchema */

import { TOOL_DEFINITIONS, getToolDefinition, getToolDefinitions, getToolGroups, getToolSurfaceManifest } from "./registry.js";

const TOOL_NAMES = TOOL_DEFINITIONS.map((definition) => definition.name);
const TOOL_NAME_SET = new Set(TOOL_NAMES);
const WORK_ID_SCHEMA = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 200,
  description: 'Opaque principal-bound work-session ID returned by relai_begin_work.'
});

/** @param {ToolDefinitionMetadata} definition @returns {ToolSchema} */
function schemaFromDefinition(definition) {
  const properties = { ...(definition.inputSchema?.properties || {}) };
  const taskScoped = definition.behavior?.taskScope === 'required';
  const taskAware = taskScoped || definition.behavior?.taskScope === 'optional';
  if (taskAware) properties.work_id = WORK_ID_SCHEMA;
  const stripped = definition.connectorStrip || [];
  for (const key of stripped) delete properties[key];
  const required = (definition.inputSchema?.required || [])
    .filter((key) => !stripped.includes(key))
    .filter((key) => !(taskScoped && key === 'workspace'));
  if (taskScoped && !required.includes('work_id')) required.push('work_id');
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: {
      ...definition.inputSchema,
      properties,
      required
    },
    outputSchema: definition.outputSchema,
    annotations: definition.annotations
  };
}

/** @type {ToolSchema[]} */
const toolSchemas = TOOL_DEFINITIONS.map(schemaFromDefinition);
const publicToolSchemas = toolSchemas.map(({ outputSchema: _outputSchema, ...schema }) => schema);

function getToolSchemas(config) {
  return withWorkspaceAliases(toolSchemas, config);
}

function getPublicToolSchemas(config) {
  return withWorkspaceAliases(publicToolSchemas, config);
}

function withWorkspaceAliases(schemas, config) {
  const aliases = Object.keys(config?.workspaces || {}).sort((left, right) => left.localeCompare(right));
  if (aliases.length === 0) return schemas;
  return schemas.map((schema) => {
    if (!schema.inputSchema?.properties?.workspace) return schema;
    return {
      ...schema,
      inputSchema: {
        ...schema.inputSchema,
        properties: {
          ...schema.inputSchema.properties,
          workspace: {
            ...schema.inputSchema.properties.workspace,
            description: `Configured workspace alias or the exact absolute path of a configured workspace. Aliases: ${aliases.join(', ')}. Relative paths such as '.' are not accepted.`
          }
        }
      }
    };
  });
}

function getToolMetadata() {
  return TOOL_DEFINITIONS.map((definition) => ({
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

/** @param {string} name @returns {boolean} */
function isToolCallable(name) {
  return TOOL_NAME_SET.has(name);
}

export { toolSchemas, publicToolSchemas, getToolSchemas, getPublicToolSchemas, getToolMetadata, getToolDefinition, getToolDefinitions, getToolGroups, getToolSurfaceManifest, isToolCallable, TOOL_NAMES };
