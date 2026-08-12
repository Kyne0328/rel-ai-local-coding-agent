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
  // Keep the connector-facing object flat. OpenAI's MCP importer projects each
  // top-level oneOf branch as a complete argument object, so branches that only
  // carry required/const constraints hide the shared top-level properties. The
  // executable schema and operation dispatcher still enforce those constraints.
  const { allOf: _runtimeGuards, oneOf: _runtimeVariants, ...schema } = inputSchema || {};
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
