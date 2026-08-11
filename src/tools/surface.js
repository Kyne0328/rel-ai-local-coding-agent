import { TOOL_SURFACE_VERSION, getCatalogTools } from './actionCatalog.js';
import { schemaFromDefinition } from './schemaBuilder.js';

const tools = getCatalogTools();

function getToolMetadata() {
  return tools.map(tool => {
    const { definition } = tool;
    const actions = actionMetadata(tool);
    return {
      name: definition.name,
      title: definition.title || definition.name,
      displayName: definition.name.replace(/^relai_/, '').replaceAll('_', ' '),
      description: definition.description || '',
      category: definition.dashboard?.category || 'Workspace tools',
      requiredProfile: definition.dashboard?.requiredProfile || 'workspace',
      requiresApproval: definition.dashboard?.requiresApproval === true,
      capabilities: [...(definition.dashboard?.capabilities || ['inspect'])],
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

function getToolSurfaceManifest() {
  const manifestTools = tools.map(tool => {
    const { definition } = tool;
    const actions = actionMetadata(tool);
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
    schemaVersion: 6,
    toolSurfaceVersion: TOOL_SURFACE_VERSION,
    toolCount: manifestTools.length,
    tools: manifestTools,
    deprecations: [],
    compatibilityAliases: {}
  };
}

function actionMetadata(tool) {
  return tool.actions
    .filter(entry => entry.action !== 'default')
    .map(entry => ({
      action: entry.action,
      operation: entry.operationName,
      fields: [...entry.fields],
      required: [...entry.required],
      executionClass: entry.behavior?.executionClass || 'bounded_synchronous',
      taskSupport: entry.execution?.taskSupport || 'forbidden',
      taskScope: entry.behavior?.taskScope || 'required',
      concurrencyScope: entry.behavior?.concurrencyScope || 'task',
      annotations: entry.annotations || tool.definition.annotations || {}
    }));
}

function aggregateTaskSupport(definition, actions) {
  return actions.some(action => action.taskSupport === 'optional')
    ? 'optional'
    : definition.execution?.taskSupport || 'forbidden';
}

function getToolGroups() {
  const definitions = tools.map(tool => tool.definition);
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
