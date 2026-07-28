// @ts-check

/** @typedef {import('../../types/boundaries.d.ts').ToolDefinition} ToolDefinition */

import { HANDLERS } from './handlers.js';
import { getToolDefinitions as getToolDefinitionMetadata } from './registry.js';

/** @type {readonly ToolDefinition[]} */
const EXECUTABLE_TOOL_DEFINITIONS = Object.freeze(getToolDefinitionMetadata().map(metadata => {
  const handler = HANDLERS[metadata.handlerName];
  if (typeof handler !== 'function') {
    throw new Error(`Tool '${metadata.name}' references unknown handler '${metadata.handlerName}'.`);
  }
  return Object.freeze({ ...metadata, handler });
}));

const EXECUTABLE_TOOL_DEFINITION_BY_NAME = new Map(
  EXECUTABLE_TOOL_DEFINITIONS.map(definition => [definition.name, definition])
);

/** @param {string} name @returns {ToolDefinition | null} */
function getExecutableToolDefinition(name) {
  return EXECUTABLE_TOOL_DEFINITION_BY_NAME.get(String(name || '')) || null;
}

/** @returns {readonly ToolDefinition[]} */
function getExecutableToolDefinitions() {
  return EXECUTABLE_TOOL_DEFINITIONS;
}

export { getExecutableToolDefinition, getExecutableToolDefinitions };
