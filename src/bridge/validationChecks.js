import { discoverCommands } from '../commandDiscovery.js';
import { normalizeCommandAlias } from '../commandNormalizer.js';
import { detectVerifyChecks } from './checkDetection.js';

function hasRequestedChecks(args = {}) {
  return Boolean(args.verify || args.check || args.checks || args.checksText || args.command || args.commands || args.commandsText);
}

function normalizeVerifyChecks(args, root, level) {
  const discovered = discoverCommands(root);
  const aliasNormalizations = { count: 0 };
  const resolveAndTrack = makeResolver(discovered, aliasNormalizations);
  const explicit = collectExplicitChecks(args, resolveAndTrack);
  const candidates = explicit.length ? explicit : detectVerifyChecks(root, level);
  const checks = [];
  const skippedChecks = [];
  const seen = new Set();
  for (const item of candidates) {
    const command = String(item || '').trim();
    if (!command) {
      skippedChecks.push({ command: '', reason: 'empty' });
      continue;
    }
    if (seen.has(command)) {
      skippedChecks.push({ command, reason: 'duplicate' });
      continue;
    }
    seen.add(command);
    checks.push(command);
  }
  return { checks, skippedChecks, aliasNormalizations: aliasNormalizations.count };
}

function makeResolver(discovered, aliasNormalizations) {
  return raw => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return trimmed;
    const { command, normalized } = normalizeCommandAlias(trimmed, trimmed, discovered);
    if (normalized) aliasNormalizations.count += 1;
    return command;
  };
}

function collectExplicitChecks(args, resolveAndTrack) {
  const explicit = [];
  pushResolvedExplicit(explicit, args.check ?? args.command, resolveAndTrack);
  pushResolvedCommands(explicit, args.checks ?? args.commands, resolveAndTrack);
  pushResolvedCommandText(explicit, args.checksText ?? args.commandsText, resolveAndTrack);
  return explicit;
}

function pushResolvedExplicit(target, value, resolveAndTrack) {
  if (typeof value === 'string' && value.trim()) target.push(resolveAndTrack(value));
}

function pushResolvedCommands(target, commands, resolveAndTrack) {
  if (!Array.isArray(commands)) return;
  for (const item of commands) {
    const command = resolveAndTrack(String(item || ''));
    if (command) target.push(command);
  }
}

function pushResolvedCommandText(target, commandsText, resolveAndTrack) {
  if (typeof commandsText !== 'string' || !commandsText.trim()) return;
  for (const line of commandsText.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) target.push(resolveAndTrack(trimmedLine));
  }
}

export { hasRequestedChecks, normalizeVerifyChecks };