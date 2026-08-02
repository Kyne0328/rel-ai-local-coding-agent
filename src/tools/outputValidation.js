import { fromJsonSchema } from '@modelcontextprotocol/server';
import { resolveToolOperation } from './dispatch.js';

async function validateToolOutput(_config, name, args, output) {
  const resolution = resolveToolOperation(name, args || {});
  const schema = resolution?.definition?.outputSchema;
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
  throw new Error(`Output validation error for ${name}${resolution?.action ? ` action ${resolution.action}` : ''}: ${details.join('; ')}.${unexpectedSuffix}`);
}

export { validateToolOutput };
