const KNOWN_RUNNABLE_PREFIXES = new Set([
  'npm', 'yarn', 'pnpm', 'npx',
  'make', 'go', 'cargo',
  'flutter', 'dart',
  'python', 'python3', 'pytest',
  'jest', 'mocha', 'vitest',
  'node', 'deno', 'bun',
  'echo', 'sh', 'bash',
]);

function normalizeCommandAlias(commandKey, commandValue, discoveredCommands) {
  const value = String(commandValue ?? '').trim();
  const key = String(commandKey ?? '').trim();
  const disc = discoveredCommands && typeof discoveredCommands === 'object' && !Array.isArray(discoveredCommands)
    ? discoveredCommands
    : {};

  if (!value) {
    return { command: key, normalized: false, warning: 'empty command value' };
  }

  // Key maps to a discovered command (checked BEFORE value-match)
  if (Object.hasOwn(disc, key)) {
    return { command: disc[key], normalized: true, originalValue: value };
  }

  // Already a canonical discovered value
  if (Object.values(disc).includes(value)) {
    return { command: value, normalized: false };
  }

  // Looks like a directly runnable command
  const firstWord = value.split(/\s+/)[0].toLowerCase();
  if (KNOWN_RUNNABLE_PREFIXES.has(firstWord)) {
    return { command: value, normalized: false };
  }

  return {
    command: value,
    normalized: false,
    warning: 'command not found in discovered commands — may be stale'
  };
}

module.exports = { normalizeCommandAlias };
