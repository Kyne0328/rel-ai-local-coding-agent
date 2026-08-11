import {
  cancelRepositoryIndex,
  ensureRepositoryIndex,
  noteRepositoryMutation,
  rebuildRepositoryIndex,
  recoverRepositoryIndex,
  repositoryIndexStatus,
  shutdownRepositoryIndexes
} from './indexer.js';
import { queryCodeInspect, querySemanticSearch } from './queryService.js';
import { cachedRepositoryContext } from './contextPlanner.js';

function createRepositoryIntelligenceService() {
  return Object.freeze({
    ensure: (workspace, config = {}, options = {}) => ensureRepositoryIndex(workspace, config, options),
    codeInspect: (workspace, config = {}, args = {}, options = {}) => queryCodeInspect(workspace, config, args, options),
    architecture: (workspace, config = {}, args = {}, options = {}) => queryCodeInspect(workspace, config, { ...args, action: 'architecture' }, options),
    cachedContext: (workspace, config = {}, options = {}) => cachedRepositoryContext(workspace, config, options),
    semanticSearch: (workspace, config = {}, args = {}, options = {}) => querySemanticSearch(workspace, config, args, options),
    noteMutation: (workspace, config = {}, paths = []) => noteRepositoryMutation(workspace, config, paths),
    status: (workspace, config = {}) => repositoryIndexStatus(workspace, config),
    rebuild: (workspace, config = {}, options = {}) => rebuildRepositoryIndex(workspace, config, options),
    recover: (workspace, config = {}, options = {}) => recoverRepositoryIndex(workspace, config, options),
    cancel: (workspace, config = {}, reason) => cancelRepositoryIndex(workspace, config, reason),
    shutdown: () => shutdownRepositoryIndexes()
  });
}

const repositoryIntelligence = createRepositoryIntelligenceService();

export { createRepositoryIntelligenceService, repositoryIntelligence };
