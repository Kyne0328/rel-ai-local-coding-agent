import { repositoryIntelligence } from '../repository/intelligence/service.js';

async function relaiSemanticSearch(workspace, config, args = {}, context = {}) {
  return repositoryIntelligence.semanticSearch(workspace, config, args, { signal: context.signal });
}

export { relaiSemanticSearch };
