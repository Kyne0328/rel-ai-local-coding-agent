'use strict';

const { getToolDefinition } = require("./schema");
const { getHandler } = require("./handlers");

async function dispatchTool(config, name, args = {}) {
  const definition = getToolDefinition(name);
  if (!definition) throw new Error(`Unknown tool: ${name}`);
  const handler = getHandler(definition.handler);
  if (!handler) throw new Error(`Tool '${name}' references missing handler '${definition.handler}'.`);
  return handler(config, args);
}

module.exports = { dispatchTool };
