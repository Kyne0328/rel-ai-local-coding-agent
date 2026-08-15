const PUBLIC_INPUT_DESCRIPTIONS = Object.freeze({
  relai_exec: new Set([
    'description',
    'properties.command.description',
    'properties.executable.description',
    'properties.argv.description',
    'properties.input.description'
  ])
});

function compactPublicInputSchema(name, inputSchema) {
  // Keep shared connector properties at the top level. OpenAI's MCP importer can
  // project a top-level oneOf branch as a complete argument object, hiding shared
  // properties. Preserve the constraints that help callers construct a valid
  // request (required fields, bounds, and primary modes), while leaving known
  // action-only extras to runtime normalization.
  const schema = connectorSafeInputSchema(inputSchema || {});
  return stripPublicDescriptions(schema, PUBLIC_INPUT_DESCRIPTIONS[name] || new Set());
}

function connectorSafeInputSchema(inputSchema) {
  const { oneOf: variants, allOf: _runtimeFieldGuards, ...schema } = inputSchema;
  const allOf = [];
  if (Array.isArray(variants) && variants.length) {
    if (variants.every(isActionVariant)) {
      allOf.push(...variants.map(actionVariantGuard));
    } else {
      allOf.push({ oneOf: variants });
    }
  }
  return { ...schema, ...(allOf.length ? { allOf } : {}) };
}

function isActionVariant(branch) {
  return branch?.properties?.action?.const != null;
}

function actionVariantGuard(branch) {
  const { properties = {}, required = [], ...constraints } = branch;
  const { action, ...branchProperties } = properties;
  const branchRequired = required.filter(field => field !== 'action');
  return {
    if: { properties: { action }, required: ['action'] },
    then: {
      ...constraints,
      ...(Object.keys(branchProperties).length ? { properties: branchProperties } : {}),
      ...(branchRequired.length ? { required: branchRequired } : {})
    }
  };
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

function compactPublicOutputSchema(name, outputSchema) {
  const keys = Object.keys(outputSchema?.properties || {});
  const properties = { ok: { type: 'boolean' } };
  if (name === 'relai_search') {
    properties.neuralEmbeddings = { type: 'boolean' };
    properties.originalBytes = { type: 'number' };
  }
  return {
    type: 'object',
    properties,
    patternProperties: { [`^(?:${keys.map(escapeRegex).join('|')})$`]: {} },
    required: ['ok'],
    additionalProperties: false
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { compactPublicInputSchema, compactPublicOutputSchema };
