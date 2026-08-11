import { spawnSync } from 'node:child_process';

import { resolveGitExecutable } from '../../gitExecutable.js';
import { makeProcessEnvironment } from '../../processEnvironment.js';
import { isSecretPath } from '../../safety.js';
import { isTestPath, languageForPath } from './languages.js';

const SEARCH_TIMEOUT_MS = 10000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function searchGitCandidates(workspace, terms, maxResults = 1000) {
  const cleanTerms = [...new Set((terms || []).map(String).map(term => term.trim()).filter(Boolean))].slice(0, 20);
  if (!cleanTerms.length) return [];
  const executable = resolveGitExecutable() || 'git';
  const args = ['grep', '-l', '-I', '--untracked', '--no-color', '-i', '-F'];
  for (const term of cleanTerms) args.push('-e', term);
  const result = spawnSync(executable, args, {
    cwd: workspace.path,
    env: makeProcessEnvironment(),
    encoding: 'utf8',
    timeout: SEARCH_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) return [];
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
  return results;
}

export { searchGitCandidates };