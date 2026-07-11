// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').ToolDefinition} ToolDefinition */
/** @typedef {import('../../types/boundaries').ToolSchema} ToolSchema */

const {
  TOOL_DEFINITIONS,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups
} = require('./registry');

const TOOL_NAMES = TOOL_DEFINITIONS.map((definition) => definition.name);
const TOOL_NAME_SET = new Set(TOOL_NAMES);

/** @param {ToolDefinition} definition @returns {ToolSchema} */
function schemaFromDefinition(definition) {
  const properties = { ...(definition.inputSchema?.properties || {}) };
  const stripped = definition.connectorStrip || [];
  for (const key of stripped) delete properties[key];
  const required = (definition.inputSchema?.required || []).filter((key) => !stripped.includes(key));
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: {
      ...definition.inputSchema,
      properties,
      required
    },
    annotations: definition.annotations
  };
}

/** @type {ToolSchema[]} */
const toolSchemas = TOOL_DEFINITIONS.map(schemaFromDefinition);

function getToolSchemas() {
  return toolSchemas;
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
    parameters: Object.keys(schemaFromDefinition(definition).inputSchema.properties || {})
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
  isToolCallable,
  TOOL_NAMES
};
