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
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: { ...definition.inputSchema, properties, required },
    outputSchema: definition.outputSchema,
    annotations: definition.annotations
  };
}

function withWorkspaceAliases(schemas, config) {
  const aliases = Object.keys(config?.workspaces || {}).sort((left, right) => left.localeCompare(right));
  if (aliases.length === 0) return schemas;
  return schemas.map(schema => {
    if (schema.name !== 'relai_work' || !schema.inputSchema?.properties?.workspace) return schema;
    return {
      ...schema,
      inputSchema: {
        ...schema.inputSchema,
        properties: {
          ...schema.inputSchema.properties,
          workspace: {
            ...schema.inputSchema.properties.workspace,
            description: `Configured alias or registered path. Aliases: ${aliases.join(', ')}.`
          }
        }
      }
    };
  });
}

export { schemaFromDefinition, withWorkspaceAliases };
