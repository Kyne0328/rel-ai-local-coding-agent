// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').AppConfig} AppConfig */
/** @typedef {import('../../types/boundaries').ToolArgs} ToolArgs */

const { getToolDefinition } = require("./schema");
const { getHandler } = require("./handlers");

/** @param {AppConfig} config @param {string} name @param {ToolArgs} [args] @param {{ connector?: boolean }} [context] */
async function dispatchTool(config, name, args = {}, context = {}) {
  const definition = getToolDefinition(name);
  if (!definition) throw new Error(`Unknown tool: ${name}`);
  const handler = getHandler(definition.handler);
  if (!handler) throw new Error(`Tool '${name}' references missing handler '${definition.handler}'.`);
  return handler(config, args, context);
}

module.exports = { dispatchTool };
