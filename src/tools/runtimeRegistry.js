// @ts-check

import { fromJsonSchema } from '@modelcontextprotocol/server';
import { HANDLERS } from './handlers.js';
import {
  getCatalogToolDefinition as getPublicMetadata,
  getCatalogToolDefinitions as getPublicDefinitions,
  getOperationDefinitions as getOperationMetadata,
  resolveToolOperation
} from './actionCatalog.js';

// Executable-only function map retained to avoid the handlers -> status -> schema -> catalog import cycle.
// The catalog remains the sole owner of schemas, policy, and execution metadata.
const OPERATION_METADATA = getOperationMetadata();
const OPERATION_EXECUTABLES = new Map(OPERATION_METADATA.map(metadata => {
  const handler = HANDLERS[metadata.handlerName];
  if (typeof handler !== 'function') {
    throw new Error(`Internal operation '${metadata.name}' references unknown handler '${metadata.handlerName}'.`);
  }
  return [metadata.name, Object.freeze({ ...metadata, handler })];
}));
const OPERATION_INPUT_VALIDATORS = new Map(OPERATION_METADATA.map(metadata => [
  metadata.name,
  fromJsonSchema(metadata.inputSchema)['~standard']
]));

function resolveExecutableToolCall(name, args = {}, _config = {}) {
  const operation = resolveToolOperation(name, args);
  if (!operation) return null;
  const executionDefinition = OPERATION_EXECUTABLES.get(operation.operationName);
  if (!executionDefinition) {
    throw new Error(`Tool '${name}' resolves to unknown internal operation '${operation.operationName}'.`);
  }
  const publicDefinition = getPublicMetadata(name);
  if (!publicDefinition) return null;
  const actionExecutionDefinition = operation.catalogEntry?.behavior
    ? Object.freeze({ ...executionDefinition, behavior: operation.catalogEntry.behavior })
    : executionDefinition;
  return {
    publicDefinition,
    executionDefinition: actionExecutionDefinition,
    operationName: operation.operationName,
    operationArgs: operation.operationArgs,
    action: operation.action || '',
    compact: true
  };
}

async function validateExecutableOperationInput(operationName, args = {}, options = {}) {
  const name = String(operationName || '');
  const validator = OPERATION_INPUT_VALIDATORS.get(name);
  if (!validator) throw new Error(`Unknown internal operation '${name}'.`);
  const input = Object.fromEntries(Object.entries(args || {}).filter(([key]) => !['work_id', '_operationTaskId'].includes(key)));
  const result = await validator.validate(input);
  if (!result.issues) return;
  const details = result.issues.map(issue => {
    const location = Array.isArray(issue.path)
      ? issue.path.map(segment => String(segment?.key ?? segment)).filter(Boolean).join('.')
      : '';
    return `${location || '<root>'}: ${issue.message}`;
  });
  const publicLabel = String(options.publicLabel || '').trim();
  throw new Error(`Input validation error for ${publicLabel || name}: ${details.join('; ')}.`);
}

function getExecutableToolDefinition(name, config = {}, args) {
  const publicDefinition = getPublicMetadata(name);
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
  return getPublicDefinitions().map(definition => getExecutableToolDefinition(definition.name, config));
}

export { getExecutableToolDefinition, getExecutableToolDefinitions, resolveExecutableToolCall, validateExecutableOperationInput };
