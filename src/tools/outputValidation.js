import { fromJsonSchema } from '@modelcontextprotocol/server';
import { getToolSchemas } from './schema.js';

async function validateToolOutput(config, name, output) {
  const schema = getToolSchemas(config).find(item => item.name === name)?.outputSchema;
  if (!schema) return;
  const result = await fromJsonSchema(schema)['~standard'].validate(output);
  if (!result.issues) return;

  const details = result.issues.map(issue => {
    const location = Array.isArray(issue.path)
      ? issue.path.map(segment => String(segment?.key ?? segment)).filter(Boolean).join('.')
      : '';
    return `${location || '<root>'}: ${issue.message}`;
  });
  const allowed = new Set(Object.keys(schema.properties || {}));
  const unexpected = output && typeof output === 'object'
    ? Object.keys(output).filter(key => !allowed.has(key))
    : [];
  const unexpectedSuffix = unexpected.length ? ` Unexpected fields: ${unexpected.join(', ')}.` : '';
  throw new Error(`Output validation error for ${name}: ${details.join('; ')}.${unexpectedSuffix}`);
}

export { validateToolOutput };
