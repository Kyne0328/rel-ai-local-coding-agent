import { runProcess } from '../../process.js';
import { isSecretPath } from '../../safety.js';
import { isTestPath, languageForPath } from './languages.js';

const SEARCH_TIMEOUT_MS = 10000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

async function searchGitCandidates(workspace, terms, maxResults = 1000, options = {}) {
  const cleanTerms = [...new Set((terms || []).map(String).map(term => term.trim()).filter(Boolean))].slice(0, 20);
  if (!cleanTerms.length) return { available: true, results: [] };
  const args = ['grep', '-l', '-I', '--untracked', '--no-color', '-i', '-F'];
  for (const term of cleanTerms) args.push('-e', term);
  const result = await runProcess('git', args, {
    cwd: workspace.path,
    timeout: SEARCH_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    signal: options.signal
  });
  if (result.spawnError || result.timedOut || (result.exitCode !== 0 && result.exitCode !== 1)) {
    return {
      available: false,
      reason: String(result.error || result.stderr || `git grep exited ${result.exitCode ?? -1}`).trim().slice(0, 1000),
      results: []
    };
  }
  const results = [];
  for (const raw of String(result.stdout || '').split(/\r?\n/)) {
    const relativePath = raw.trim().replaceAll('\\', '/');
    if (!relativePath || isSecretPath(relativePath)) continue;
    results.push({
      path: relativePath,
      language: languageForPath(relativePath),
      test: isTestPath(relativePath),
      provider: 'git-grep',
      reasons: ['full-source-lexical']
    });
    if (results.length >= maxResults) break;
  }
  return { available: true, results };
}

export { searchGitCandidates };