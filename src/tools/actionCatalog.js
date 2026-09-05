// @ts-check

import {
  getCatalogToolDefinition,
  getCatalogToolDefinitions,
  getOperationDefinition,
  getOperationDefinitions,
  getPublicActionContract
} from './actionDefinitions.js';
import { ACTION_REGISTRY } from './actionRegistry.js';

const TOOL_SURFACE_VERSION = 68;

const TOOL_ACTION_CATALOG = Object.freeze(buildCatalog());
const ACTION_BY_KEY = new Map(TOOL_ACTION_CATALOG.map(entry => [catalogKey(entry.publicTool, entry.action), entry]));
const TOOL_CATALOG = Object.freeze(getCatalogToolDefinitions().map(definition => Object.freeze({
  definition,
  actions: Object.freeze(TOOL_ACTION_CATALOG.filter(entry => entry.publicTool === definition.name))
})));

function buildCatalog() {
  const entries = [];
  for (const [publicTool, actions] of Object.entries(ACTION_REGISTRY)) {
    const publicDefinition = getCatalogToolDefinition(publicTool);
    if (!publicDefinition) throw new Error(`Catalog references unknown public tool '${publicTool}'.`);
    for (const [action, mapping] of Object.entries(actions)) {
      const operationMetadata = getOperationDefinition(mapping.operationName);
      if (!operationMetadata) {
        throw new Error(`Catalog action ${publicTool}:${action} references unknown operation '${mapping.operationName}'.`);
      }
      const contract = actionContract(publicDefinition, action);
      const capability = mapping.capability;
      if (!capability) throw new Error(`Catalog action ${publicTool}:${action} has no authorization capability.`);
      entries.push(Object.freeze({
        publicTool,
        action,
        operationName: mapping.operationName,
        keepAction: mapping.keepAction,
        title: operationMetadata.title,
        description: operationMetadata.description,
        fields: contract.fields,
        required: contract.required,
        inputSchema: operationMetadata.inputSchema,
        outputSchema: operationMetadata.outputSchema,
        annotations: operationMetadata.annotations,
        behavior: Object.freeze({ ...operationMetadata.behavior, ...(mapping.behavior || {}) }),
        execution: operationMetadata.execution,
        dashboard: operationMetadata.dashboard,
        groups: operationMetadata.groups,
        capability,
        approval: mapping.approval || null,
        handlerName: operationMetadata.handlerName
      }));
    }
  }
  return entries;
}

function actionContract(publicDefinition, action) {
  return getPublicActionContract(publicDefinition, action);
}

function catalogKey(publicTool, action) {
  return `${publicTool}:${action || 'default'}`;
}

function getToolActionCatalog() {
  return TOOL_ACTION_CATALOG;
}

function getCatalogTools() {
  return TOOL_CATALOG;
}


/** @param {string} publicTool @param {Record<string, any>} args */
function getCatalogAction(publicTool, args = {}) {
  const actions = ACTION_REGISTRY[String(publicTool || '')];
  if (!actions) return null;
  const action = Object.hasOwn(actions, 'default') ? 'default' : String(args.action || '').trim();
  const entry = ACTION_BY_KEY.get(catalogKey(publicTool, action));
  if (!entry) {
    const choices = Object.keys(actions).filter(value => value !== 'default');
    throw new Error(`Unsupported action '${action || '(missing)'}' for ${publicTool}. Supported actions: ${choices.join(', ')}.`);
  }
  return entry;
}

/** @param {string} name @param {Record<string, any>} args */
function resolveToolOperation(name, args = {}) {
  const publicName = String(name || '');
  const entry = getCatalogAction(publicName, args);
  if (!entry) return null;
  let operationArgs = { ...(args || {}) };
  if (!entry.keepAction) delete operationArgs.action;
  operationArgs = normalizeOperationArguments(publicName, entry.action, entry, operationArgs);
  return {
    publicName,
    action: entry.action === 'default' ? '' : entry.action,
    operationName: entry.operationName,
    operationArgs,
    definition: getOperationDefinition(entry.operationName),
    catalogEntry: entry,
    compact: true
  };
}

function normalizeOperationArguments(publicName, action, entry, args) {
  const allowed = new Set([...(entry.fields || []), '_operationTaskId']);
  if (entry.keepAction) allowed.add('action');
  const unsupported = Object.keys(args).filter(field => !allowed.has(field));
  if (unsupported.length) {
    throw new Error(`Unsupported field '${unsupported[0]}' for ${publicName} action ${action}.`);
  }
  for (const field of entry.required || []) {
    if (args[field] === undefined || args[field] === null || args[field] === '') {
      throw new Error(`Missing required field '${field}' for ${publicName} action ${action}.`);
    }
  }
  return args;
}

function getOperationCapability(operationName) {
  const name = String(operationName || '');
  const entries = TOOL_ACTION_CATALOG.filter(entry => entry.operationName === name);
  if (!entries.length) return '';
  const capabilities = new Set(entries.map(entry => entry.capability));
  if (capabilities.size !== 1) throw new Error(`Operation '${name}' has conflicting action capabilities.`);
  const first = entries[0];
  return first ? first.capability : '';
}

/** @param {string} publicTool @param {Record<string, any>} args */
function catalogApprovalRequirement(publicTool, args = {}) {
  const resolution = resolveToolOperation(publicTool, args);
  if (!resolution?.catalogEntry?.approval) return null;
  return resolution.catalogEntry.approval(resolution.operationArgs);
}

export {
  ACTION_REGISTRY,

  TOOL_SURFACE_VERSION,
  catalogApprovalRequirement,
  getCatalogAction,
  getCatalogToolDefinition,
  getCatalogToolDefinitions,
  getCatalogTools,
  getOperationCapability,
  getOperationDefinition,
  getOperationDefinitions,
  getToolActionCatalog,
  resolveToolOperation
};
