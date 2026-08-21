const PUBLIC_INPUT_DESCRIPTIONS = Object.freeze({
  relai_edit: new Set([
    'description',
    'properties.workspace.description',
    'properties.path.description',
    'properties.oldText.description',
    'properties.newText.description',
    'properties.occurrence.description',
    'properties.replacements.description',
    'properties.content.description',
    'properties.expectedSha256.description',
    'properties.updateText.description',
    'properties.envAction.description',
    'properties.key.description',
    'properties.value.description',
    'properties.templatePath.description',
    'properties.edits.description',
    'properties.runChecks.description',
    'properties.level.description',
    'properties.returnDiff.description',
    'properties.dryRun.description',
    'properties.stage.description',
    'properties.writeId.description'
  ]),
  relai_exec: new Set([
    'description',
    'properties.command.description',
    'properties.executable.description',
    'properties.argv.description',
    'properties.input.description',
    'properties.cwd.description',
    'properties.env.description',
    'properties.timeoutMs.description',
    'properties.maxOutputBytes.description'
  ]),
  relai_process: new Set([
    'properties.command.description',
    'properties.executable.description',
    'properties.argv.description',
    'properties.input.description'
  ])
});

function compactPublicInputSchema(name, inputSchema, catalogTool) {
  // Discovery is an ergonomic projection, not a second validator. Keep every
  // callable field visible to MCP clients, but leave action/form exclusivity and
  // conditional requirements to the canonical runtime contract. Some clients
  // simplify nested oneOf/anyOf/if schemas during import and can otherwise hide
  // valid fields (for example batched search queries) or collapse a tool to an
  // untyped argument object.
  const schema = importSafeInputSchema(inputSchema || {});
  const compact = stripPublicDescriptions(schema, PUBLIC_INPUT_DESCRIPTIONS[name] || new Set());
  const withInputForm = annotateInputForm(compact, inputSchema);
  return annotateActionFieldUsage(withInputForm, catalogTool);
}

function importSafeInputSchema(inputSchema) {
  const {
    oneOf: _oneOf,
    anyOf: _anyOf,
    allOf: _allOf,
    if: _if,
    then: _then,
    else: _else,
    not: _not,
    propertyNames: _propertyNames,
    ...schema
  } = inputSchema;
  return schema;
}

function stripPublicDescriptions(value, retained, path = '') {
  if (Array.isArray(value)) return value.map(item => stripPublicDescriptions(item, retained, path));
  if (!value || typeof value !== 'object') return value;
  const compact = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'description' && !retained.has(childPath)) continue;
    compact[key] = stripPublicDescriptions(child, retained, childPath);
  }
  return compact;
}

function annotateActionFieldUsage(schema, catalogTool) {
  const actions = (catalogTool?.actions || []).filter(entry => entry.action !== 'default');
  if (!actions.length || !schema?.properties) return schema;

  const properties = { ...schema.properties };
  if (properties.action) {
    const formHints = actions.map(actionInputFormHint).filter(Boolean);
    properties.action = {
      ...properties.action,
      description: [
        `Choose one action: ${actions.map(entry => entry.action).join(', ')}. Use only fields for the selected action.`,
        formHints.length ? `Input forms: ${formHints.join('; ')}.` : ''
      ].filter(Boolean).join(' ')
    };
  }

  for (const [field, fieldSchema] of Object.entries(properties)) {
    if (field === 'action') continue;
    const hint = actionFieldHint(actions, field);
    if (!hint) continue;
    properties[field] = {
      ...fieldSchema,
      description: [fieldSchema?.description, hint].filter(Boolean).join(' ')
    };
  }
  return { ...schema, properties };
}

function annotateInputForm(schema, inputSchema) {
  const form = inputFormAlternatives(inputSchema);
  if (!form) return schema;
  return {
    ...schema,
    description: [schema.description, `Input form: ${form}.`].filter(Boolean).join(' ')
  };
}

function actionInputFormHint(entry) {
  const form = inputFormAlternatives(entry.inputSchema);
  return form ? `${entry.action}: ${form}` : '';
}

function inputFormAlternatives(schema) {
  const branches = Array.isArray(schema?.oneOf) ? schema.oneOf : Array.isArray(schema?.anyOf) ? schema.anyOf : [];
  if (branches.length < 2 || branches.length > 4) return '';
  const alternatives = branches.map(branch => [...new Set((branch?.required || [])
    .filter(field => !['workspace', 'work_id', 'action'].includes(field)))].sort());
  if (alternatives.some(fields => fields.length === 0)) return '';
  const labels = alternatives.map(fields => fields.join(' + '));
  if (new Set(labels).size !== labels.length) return '';
  return labels.join(' or ');
}

function actionFieldHint(actions, field) {
  const owners = actions.filter(entry => entry.fields?.includes(field));
  if (!owners.length) return '';
  const requiredOwners = new Set(owners.filter(entry => entry.required?.includes(field)).map(entry => entry.action));
  const constraintSignatures = owners.map(entry => fieldConstraintSignature(entry.inputSchema?.properties?.[field]));
  const includeConstraints = new Set(constraintSignatures).size > 1;
  const ownedByAll = owners.length === actions.length;
  const uniformRequirement = requiredOwners.size === 0 || requiredOwners.size === owners.length;
  if (ownedByAll && uniformRequirement && !includeConstraints) return '';

  const usage = owners.map((entry, index) => {
    const required = requiredOwners.has(entry.action) ? ' (required)' : '';
    const constraint = includeConstraints && constraintSignatures[index] ? ` ${constraintSignatures[index]}` : '';
    return `${entry.action}${required}${constraint}`;
  });
  return `Action usage: ${usage.join('; ')}.`;
}

function fieldConstraintSignature(schema) {
  if (!schema || typeof schema !== 'object') return '';
  if (schema.type === 'number' || schema.type === 'integer') {
    if (Number.isFinite(schema.minimum) && Number.isFinite(schema.maximum)) return `[${schema.minimum}-${schema.maximum}]`;
    if (Number.isFinite(schema.minimum)) return `[>=${schema.minimum}]`;
    if (Number.isFinite(schema.maximum)) return `[<=${schema.maximum}]`;
  }
  if (schema.type === 'string') {
    if (Number.isFinite(schema.minLength) && Number.isFinite(schema.maxLength)) return `[${schema.minLength}-${schema.maxLength} chars]`;
    if (Number.isFinite(schema.maxLength)) return `[<=${schema.maxLength} chars]`;
  }
  if (schema.type === 'array') {
    if (Number.isFinite(schema.minItems) && Number.isFinite(schema.maxItems)) return `[${schema.minItems}-${schema.maxItems} items]`;
    if (Number.isFinite(schema.maxItems)) return `[<=${schema.maxItems} items]`;
  }
  return '';
}

function compactPublicOutputSchema(name) {
  const properties = { ok: { type: 'boolean' } };
  if (name === 'relai_search') {
    properties.neuralEmbeddings = { type: 'boolean' };
    properties.originalBytes = { type: 'number' };
  }
  return {
    type: 'object',
    properties,
    required: ['ok'],
    additionalProperties: true
  };
}

export { compactPublicInputSchema, compactPublicOutputSchema };
