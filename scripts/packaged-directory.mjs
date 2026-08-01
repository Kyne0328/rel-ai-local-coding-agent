import path from 'node:path';
import { resolveCurrentUnpacked } from './current-unpacked.mjs';

function parsePackagedDirectoryArgument(argv) {
  const matches = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--dir') continue;
    const value = argv[index + 1];
    if (!value || value === '--' || value.startsWith('--')) throw new Error('--dir requires a directory path.');
    matches.push(String(value));
    index += 1;
  }
  if (matches.length > 1) throw new Error('--dir may be provided only once.');
  return matches[0] || '';
}

function resolvePackagedDirectory(root, argv, options = {}) {
  const requested = parsePackagedDirectoryArgument(argv);
  if (!requested) return resolveCurrentUnpacked(root, { allowBuildCheck: true });
  const platform = options.platform || process.platform;
  const cwd = options.cwd || process.cwd();
  return platform === 'win32' ? path.win32.resolve(cwd, requested) : path.resolve(cwd, requested);
}

export { parsePackagedDirectoryArgument, resolvePackagedDirectory };
