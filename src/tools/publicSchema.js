const PUBLIC_INPUT_DESCRIPTIONS = Object.freeze({
  relai_read: new Set([
    'properties.asResource.description'
  ]),
  relai_edit: new Set([
    'description',
    'properties.workspace.description',
    'properties.path.description',
    'properties.oldText.description',
    'properties.newText.description',
    'properties.occurrence.description',
    'properties.replacements.description',
    'properties.content.description',
    'properties.file.description',
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
    'properties.dryRun.description'
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
  const discoverySchema = name === 'relai_edit' ? hideInternalEditTransportFields(schema) : schema;
  const compact = stripPublicDescriptions(discoverySchema, PUBLIC_INPUT_DESCRIPTIONS[name] || new Set());
  const withInputForm = annotateInputForm(compact, inputSchema);
  if (name === 'relai_computer') return compactComputerInputSchema(withInputForm);
  return annotateActionGrammar(withInputForm, catalogTool);
}

function hideInternalEditTransportFields(schema) {
  if (!schema?.properties) return schema;
  const { stage: _stage, writeId: _writeId, ...properties } = schema.properties;
  return { ...schema, properties };
}

function compactComputerInputSchema(schema) {
  if (!schema?.properties?.action) return schema;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      action: {
        ...schema.properties.action,
        description: 'Actions: status/displays; screenshot(displayId?); move/click/double_click/right_click(x,y,displayId?); drag(x,y,toX,toY,displayId?); scroll(direction,distance?,x?,y?,displayId?); type(text); key(key); hotkey(keys).'
      }
    }
  };
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

function annotateActionGrammar(schema, catalogTool) {
  const actions = (catalogTool?.actions || []).filter(entry => entry.action !== 'default');
  if (!actions.length || !schema?.properties?.action) return schema;

  const formHints = actions.map(actionInputFormHint).filter(Boolean);
  const actionGrammar = compactActionGrammar(actions);
  return {
    ...schema,
    properties: {
      ...schema.properties,
      action: {
        ...schema.properties.action,
        description: [
          `Actions: ${actions.map(entry => entry.action).join(', ')}.`,
          actionGrammar,
          formHints.length ? `Input forms: ${formHints.join('; ')}.` : ''
        ].filter(Boolean).join(' ')
      }
    }
  };
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

function compactActionGrammar(actions) {
  const fields = [...new Set(actions.flatMap(entry => entry.fields || []))].filter(field => field !== 'action');
  const actionSpecific = new Map();

  for (const field of fields) {
    const owners = actions.filter(entry => entry.fields?.includes(field));
    const requirements = owners.map(entry => entry.required?.includes(field) === true);
    const constraints = owners.map(entry => fieldConstraintSignature(entry.inputSchema?.properties?.[field]));
    const varyingConstraint = new Set(constraints).size > 1;
    if (owners.length !== actions.length || new Set(requirements).size > 1 || varyingConstraint) {
      actionSpecific.set(field, { varyingConstraint });
    }
  }

  const parts = actions.map(entry => {
    const fieldsForAction = (entry.fields || [])
      .filter(field => actionSpecific.has(field))
      .map(field => {
        const required = entry.required?.includes(field) ? '!' : '';
        const constraint = actionSpecific.get(field).varyingConstraint
          ? fieldConstraintSignature(entry.inputSchema?.properties?.[field])
          : '';
        return `${field}${required}${constraint}`;
      });
    return fieldsForAction.length ? `${entry.action}(${fieldsForAction.join(',')})` : '';
  }).filter(Boolean);

  return parts.length ? `Action-specific fields: ${parts.join('; ')}. ! = required.` : '';
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

export { compactPublicInputSchema };
