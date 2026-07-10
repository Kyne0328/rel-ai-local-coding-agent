// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').ToolDefinition} ToolDefinition */
/** @typedef {import('../../types/boundaries').ToolSchema} ToolSchema */

const {
  TOOL_DEFINITIONS,
  getToolDefinition,
  getToolDefinitions,
  getPublicToolDefinitions,
  getToolGroups
} = require('./registry');

const BRIDGE_TOOL_NAMES = TOOL_DEFINITIONS.map((definition) => definition.name);
const PUBLIC_HTTP_TOOL_NAMES = getPublicToolDefinitions().map((definition) => definition.name);
const TOOL_NAMES = new Set(BRIDGE_TOOL_NAMES);

/** @param {ToolDefinition} definition @param {boolean} [publicSurface] @returns {ToolSchema} */
function schemaFromDefinition(definition, publicSurface = false) {
  const properties = { ...(definition.inputSchema?.properties || {}) };
  const stripped = publicSurface ? definition.publicStrip || [] : [];
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
const toolSchemas = TOOL_DEFINITIONS.map((definition) => schemaFromDefinition(definition));

function getToolSchemas() {
  return toolSchemas;
}

function getPublicToolSchemas() {
  return getPublicToolDefinitions().map((definition) => schemaFromDefinition(definition, true));
}

function getPublicToolMetadata() {
  return getPublicToolDefinitions().map((definition) => ({
    name: definition.name,
    displayName: definition.name.replace(/^relai_/, '').replaceAll('_', ' '),
    description: definition.description || '',
    category: definition.dashboard?.category || 'Workspace tools',
    requiredProfile: definition.dashboard?.requiredProfile || 'workspace',
    requiresApproval: definition.dashboard?.requiresApproval === true,
    parameters: Object.keys(schemaFromDefinition(definition, true).inputSchema.properties || {})
  }));
}

function isToolCallable(name) {
  return TOOL_NAMES.has(name);
}

module.exports = {
  toolSchemas,
  allToolSchemas: toolSchemas,
  getToolSchemas,
  getPublicToolSchemas,
  getPublicToolMetadata,
  getToolDefinition,
  getToolDefinitions,
  getPublicToolDefinitions,
  getToolGroups,
  isToolCallable,
  BRIDGE_TOOL_NAMES,
  PUBLIC_HTTP_TOOL_NAMES
};
