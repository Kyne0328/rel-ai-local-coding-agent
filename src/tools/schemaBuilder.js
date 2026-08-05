// @ts-check

/** @typedef {import('../../types/boundaries.d.ts').ToolDefinitionMetadata} ToolDefinitionMetadata */
/** @typedef {import('../../types/boundaries.d.ts').ToolSchema} ToolSchema */

const WORK_ID_SCHEMA = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 200,
  description: 'Opaque ID returned when a repository work session begins.'
});

/** @param {ToolDefinitionMetadata} definition @returns {ToolSchema} */
function schemaFromDefinition(definition) {
  const properties = { ...(definition.inputSchema?.properties || {}) };
  const taskScoped = definition.behavior?.taskScope === 'required';
  const taskAware = taskScoped || definition.behavior?.taskScope === 'optional';
  if (taskAware) properties.work_id = WORK_ID_SCHEMA;
  const stripped = definition.connectorStrip || [];
  for (const key of stripped) delete properties[key];
  const required = (definition.inputSchema?.required || [])
    .filter(key => !stripped.includes(key))
    .filter(key => !(taskScoped && key === 'workspace'));
  if (taskScoped && !required.includes('work_id')) required.push('work_id');
  const branches = Array.isArray(definition.inputSchema?.oneOf)
    ? definition.inputSchema.oneOf.map(branch => workAwareBranch(branch, { taskScoped, taskAware }))
    : undefined;
  const inputSchema = strictActionSchema({
    ...definition.inputSchema,
    properties,
    required,
    ...(branches ? { oneOf: branches } : {})
  }, definition.actionContracts || []);
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema,
    outputSchema: definition.outputSchema,
    annotations: definition.annotations
  };
}

function workAwareBranch(branch, { taskScoped, taskAware }) {
  const action = String(branch?.properties?.action?.const || '');
  const includeWorkId = taskScoped || (taskAware && action !== 'begin');
  if (!includeWorkId) return branch;
  const required = [...(branch.required || [])];
  if (taskScoped && !required.includes('work_id')) required.push('work_id');
  return {
    ...branch,
    properties: { ...(branch.properties || {}), work_id: WORK_ID_SCHEMA },
    required
  };
}

function strictActionSchema(schema, contracts) {
  if (!Array.isArray(schema.oneOf) || !contracts.length) return schema;
  const properties = schema.properties || {};
  const actionNames = contracts.map(contract => contract.action);
  const fields = [...new Set(contracts.flatMap(contract => contract.fields))].filter(field => properties[field]);
  const groups = new Map();
  for (const field of fields) {
    const allowed = contracts.filter(contract => contract.fields.includes(field)).map(contract => contract.action).sort();
    if (allowed.length === actionNames.length) continue;
    const key = allowed.join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(field);
  }
  const allOf = [...(schema.allOf || [])];
  for (const [key, groupedFields] of groups) {
    const trigger = groupedFields.length === 1
      ? { required: groupedFields }
      : { anyOf: groupedFields.sort().map(field => ({ required: [field] })) };
    allOf.push({
      if: trigger,
      then: { properties: { action: { enum: key.split('|') } } }
    });
  }
  return { ...schema, ...(allOf.length ? { allOf } : {}) };
}

export { schemaFromDefinition };
