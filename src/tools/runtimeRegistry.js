// @ts-check

import { HANDLERS } from './handlers.js';
import { getToolDefinitions as getLegacyMetadata } from './registry.js';
import { getToolDefinition as getPublicMetadata, getToolDefinitions as getPublicDefinitions } from './schema.js';
import { resolveToolOperation } from './dispatch.js';

const LEGACY_EXECUTABLES = new Map(getLegacyMetadata().map(metadata => {
  const handler = HANDLERS[metadata.handlerName];
  if (typeof handler !== 'function') {
    throw new Error(`Tool '${metadata.name}' references unknown handler '${metadata.handlerName}'.`);
  }
  return [metadata.name, Object.freeze({ ...metadata, handler })];
}));

function resolveExecutableToolCall(name, args = {}, config = {}) {
  const operation = resolveToolOperation(name, args);
  if (!operation) return null;
  const executionDefinition = LEGACY_EXECUTABLES.get(operation.operationName);
  if (!executionDefinition) {
    throw new Error(`Tool '${name}' resolves to unknown operation '${operation.operationName}'.`);
  }
  const publicDefinition = getPublicMetadata(name, config) || executionDefinition;
  return {
    publicDefinition,
    executionDefinition,
    operationName: operation.operationName,
    operationArgs: operation.operationArgs,
    action: operation.action || '',
    compact: operation.compact === true
  };
}

function getExecutableToolDefinition(name, config = {}, args) {
  const publicDefinition = getPublicMetadata(name, config);
  if (!publicDefinition) return null;
  const direct = LEGACY_EXECUTABLES.get(publicDefinition.name);
  if (direct) return direct;
  if (args) {
    const resolved = resolveExecutableToolCall(name, args, config);
    if (resolved) {
      return Object.freeze({
        ...publicDefinition,
        behavior: resolved.executionDefinition.behavior,
        annotations: resolved.executionDefinition.annotations,
        execution: resolved.executionDefinition.execution,
        handler: resolved.executionDefinition.handler
      });
    }
  }
  return Object.freeze({ ...publicDefinition, handler: null });
}

function getExecutableToolDefinitions(config = {}) {
  return getPublicDefinitions(config).map(definition => getExecutableToolDefinition(definition.name, config));
}

function getLegacyExecutableToolDefinition(name) {
  return LEGACY_EXECUTABLES.get(String(name || '')) || null;
}

export {
  getExecutableToolDefinition,
  getExecutableToolDefinitions,
  getLegacyExecutableToolDefinition,
  resolveExecutableToolCall
};
