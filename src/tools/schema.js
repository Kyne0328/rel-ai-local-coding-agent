// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').ToolDefinition} ToolDefinition */
/** @typedef {import('../../types/boundaries').ToolSchema} ToolSchema */

const {
  TOOL_DEFINITIONS,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups,
  getToolSurfaceManifest
} = require('./registry');

const TOOL_NAMES = TOOL_DEFINITIONS.map((definition) => definition.name);
const TOOL_NAME_SET = new Set(TOOL_NAMES);
const TASK_ID_SCHEMA = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 200,
  description: 'Opaque logical task ID returned by relai_start_task.'
});

/** @param {ToolDefinition} definition @returns {ToolSchema} */
function schemaFromDefinition(definition) {
  const properties = { ...(definition.inputSchema?.properties || {}) };
  if (definition.name !== 'relai_start_task') properties.task_id = TASK_ID_SCHEMA;
  const stripped = definition.connectorStrip || [];
  for (const key of stripped) delete properties[key];
  const required = (definition.inputSchema?.required || []).filter((key) => !stripped.includes(key));
  if (definition.name === 'relai_complete_task' && !required.includes('task_id')) required.push('task_id');
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

function getToolSchemas(config) {
  const aliases = Object.keys(config?.workspaces || {}).sort((left, right) => left.localeCompare(right));
  if (aliases.length === 0) return toolSchemas;
  return toolSchemas.map((schema) => {
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
    longRunning: definition.behavior?.longRunning === true
  }));
}

/** @param {string} name @returns {boolean} */
function isToolCallable(name) {
  return TOOL_NAME_SET.has(name);
}

module.exports = {
  toolSchemas,
  getToolSchemas,
  getToolMetadata,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups,
  getToolSurfaceManifest,
  isToolCallable,
  TOOL_NAMES
};
