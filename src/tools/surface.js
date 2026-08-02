import { TOOL_SURFACE_VERSION } from './compactRegistry.js';
import { COMPACT_OPERATIONS } from './dispatch.js';
import { profileFromConfig } from './profile.js';
import { definitionsFor } from './profileRegistry.js';
import { getToolDefinition as getOperationDefinition } from './registry.js';
import { schemaFromDefinition } from './schemaBuilder.js';

function getToolMetadata(config = {}) {
  return definitionsFor(config).map(definition => {
    const actions = actionMetadata(definition);
    return {
      name: definition.name,
      title: definition.title || definition.name,
      displayName: definition.name.replace(/^relai_/, '').replaceAll('_', ' '),
      description: definition.description || '',
      category: definition.dashboard?.category || 'Workspace tools',
      requiredProfile: definition.dashboard?.requiredProfile || 'workspace',
      requiresApproval: definition.dashboard?.requiresApproval === true,
      state: 'active',
      replacements: [],
      parameters: Object.keys(schemaFromDefinition(definition).inputSchema.properties || {}),
      outputFields: Object.keys(definition.outputSchema?.properties || {}),
      longRunning: definition.behavior?.longRunning === true,
      taskScope: definition.behavior?.taskScope || 'required',
      executionClass: definition.behavior?.executionClass || 'bounded_synchronous',
      taskSupport: aggregateTaskSupport(definition, actions),
      ...(actions.length ? { actions } : {})
    };
  });
}

function getToolSurfaceManifest(config = {}) {
  const tools = definitionsFor(config).map(definition => {
    const actions = actionMetadata(definition);
    return {
      name: definition.name,
      state: 'active',
      executionClass: definition.behavior?.executionClass || 'bounded_synchronous',
      taskSupport: aggregateTaskSupport(definition, actions),
      ...(actions.length ? {
        executionClasses: [...new Set(actions.map(action => action.executionClass))],
        actions
      } : {})
    };
  });
  return {
    schemaVersion: 4,
    toolSurfaceVersion: TOOL_SURFACE_VERSION,
    profile: profileFromConfig(config),
    toolCount: tools.length,
    tools,
    deprecations: [],
    compatibilityAliases: {}
  };
}

function actionMetadata(definition) {
  const contracts = Array.isArray(definition.actionContracts) ? definition.actionContracts : [];
  const mappings = COMPACT_OPERATIONS[definition.name] || {};
  return contracts.map(contract => {
    const mapping = mappings[contract.action];
    const operation = mapping?.tool || '';
    const executable = getOperationDefinition(operation);
    const taskScoped = executable?.behavior?.taskScope === 'required';
    const required = [...contract.required];
    if (taskScoped && !required.includes('work_id')) required.push('work_id');
    return {
      action: contract.action,
      operation,
      fields: [...contract.fields],
      required: required.sort(),
      executionClass: executable?.behavior?.executionClass || 'bounded_synchronous',
      taskSupport: executable?.execution?.taskSupport || 'forbidden',
      taskScope: executable?.behavior?.taskScope || 'required',
      concurrencyScope: executable?.behavior?.concurrencyScope || 'task',
      annotations: executable?.annotations || definition.annotations || {}
    };
  });
}

function aggregateTaskSupport(definition, actions) {
  return actions.some(action => action.taskSupport === 'optional')
    ? 'optional'
    : definition.execution?.taskSupport || 'forbidden';
}

function getToolGroups(config = {}) {
  const definitions = definitionsFor(config);
  const groups = { workspace: definitions.map(definition => definition.name), git: [], audit: [], cleanup: [] };
  for (const definition of definitions) {
    for (const group of definition.groups || []) {
      if (!groups[group]) groups[group] = [];
      groups[group].push(definition.name);
    }
  }
  return groups;
}

export { getToolGroups, getToolMetadata, getToolSurfaceManifest };
