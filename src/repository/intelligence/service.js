import {
  cancelRepositoryIndex,
  ensureRepositoryIndex,
  noteRepositoryMutation,
  rebuildRepositoryIndex,
  recoverRepositoryIndex,
  repositoryIndexStatus,
  shutdownRepositoryIndexes
} from './indexer.js';
import { runRepositoryQuery, shutdownRepositoryQueryWorkers } from './queryWorkerClient.js';

function createRepositoryIntelligenceService() {
  const indexedQuery = async (kind, workspace, config, args, options) => {
    const index = await ensureRepositoryIndex(workspace, config, { maxFiles: args.maxFiles, signal: options.signal, watch: options.watch });
    return runRepositoryQuery(kind, workspace, config, { args, index }, options);
  };
  return Object.freeze({
    ensure: (workspace, config = {}, options = {}) => ensureRepositoryIndex(workspace, config, options),
    codeInspect: (workspace, config = {}, args = {}, options = {}) => indexedQuery('codeInspect', workspace, config, args, options),
    architecture: (workspace, config = {}, args = {}, options = {}) => indexedQuery('codeInspect', workspace, config, { ...args, action: 'architecture' }, options),
    cachedContext: (workspace, config = {}, options = {}) => runRepositoryQuery('cachedContext', workspace, config, {}, options),
    cachedSummary: (workspace, config = {}, options = {}) => runRepositoryQuery('cachedSummary', workspace, config, {}, options),
    searchGraphContext: (workspace, config = {}, matches = [], options = {}) => runRepositoryQuery('searchGraphContext', workspace, config, { matches }, options),
    semanticSearch: (workspace, config = {}, args = {}, options = {}) => indexedQuery('semanticSearch', workspace, config, args, options),
    noteMutation: (workspace, config = {}, paths = []) => noteRepositoryMutation(workspace, config, paths),
    status: (workspace, config = {}) => repositoryIndexStatus(workspace, config),
    rebuild: (workspace, config = {}, options = {}) => rebuildRepositoryIndex(workspace, config, options),
    recover: (workspace, config = {}, options = {}) => recoverRepositoryIndex(workspace, config, options),
    cancel: (workspace, config = {}, reason) => cancelRepositoryIndex(workspace, config, reason),
    shutdown: () => Promise.all([
      shutdownRepositoryQueryWorkers(),
      shutdownRepositoryIndexes()
    ])
  });
}

const repositoryIntelligence = createRepositoryIntelligenceService();

export { createRepositoryIntelligenceService, repositoryIntelligence };
