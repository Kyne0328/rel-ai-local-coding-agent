// @ts-check

import { HANDLERS } from './handlers.js';
import {
  getCatalogToolDefinition as getPublicMetadata,
  getCatalogToolDefinitions as getPublicDefinitions,
  getOperationDefinitions as getOperationMetadata,
  resolveToolOperation
} from './actionCatalog.js';

// Executable-only function map retained to avoid the handlers -> status -> schema -> catalog import cycle.
// The catalog remains the sole owner of schemas, policy, and execution metadata.
const OPERATION_EXECUTABLES = new Map(getOperationMetadata().map(metadata => {
  const handler = HANDLERS[metadata.handlerName];
  if (typeof handler !== 'function') {
    throw new Error(`Internal operation '${metadata.name}' references unknown handler '${metadata.handlerName}'.`);
  }
  return [metadata.name, Object.freeze({ ...metadata, handler })];
}));

function resolveExecutableToolCall(name, args = {}, config = {}) {
  const operation = resolveToolOperation(name, args);
  if (!operation) return null;
  const executionDefinition = OPERATION_EXECUTABLES.get(operation.operationName);
  if (!executionDefinition) {
    throw new Error(`Tool '${name}' resolves to unknown internal operation '${operation.operationName}'.`);
  }
  const publicDefinition = getPublicMetadata(name, config);
  if (!publicDefinition) return null;
  return {
    publicDefinition,
    executionDefinition,
    operationName: operation.operationName,
    operationArgs: operation.operationArgs,
    action: operation.action || '',
    compact: true
  };
}

function getExecutableToolDefinition(name, config = {}, args) {
  const publicDefinition = getPublicMetadata(name, config);
  if (!publicDefinition) return null;
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

export { getExecutableToolDefinition, getExecutableToolDefinitions, resolveExecutableToolCall };
