import { isTestPath } from '../repository/intelligence/languages.js';
import { repositoryIntelligence } from '../repository/intelligence/service.js';

async function relaiCodeInspect(workspace, config, args = {}, context = {}) {
  return repositoryIntelligence.codeInspect(workspace, config, args, { signal: context.signal });
}

export { relaiCodeInspect, isTestPath };
