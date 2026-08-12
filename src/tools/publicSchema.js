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
  const { allOf: _runtimeGuards, ...schema } = inputSchema || {};
  return stripPublicDescriptions(schema, PUBLIC_INPUT_DESCRIPTIONS[name] || new Set());
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
