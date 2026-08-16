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

const MAX_INDEXED_QUERY_ATTEMPTS = 2;

function createRepositoryIntelligenceService() {
  const indexedQuery = async (kind, workspace, config, args, options = {}) => {
    for (let attempt = 0; attempt < MAX_INDEXED_QUERY_ATTEMPTS; attempt += 1) {
      const index = await ensureRepositoryIndex(workspace, config, { maxFiles: args.maxFiles, signal: options.signal, watch: options.watch });
      let result;
      try {
        result = await runRepositoryQuery(kind, workspace, config, { args, index }, options);
      } catch (error) {
        if (error?.code === 'QUERY_INDEX_CHANGED' && attempt + 1 < MAX_INDEXED_QUERY_ATTEMPTS) continue;
        throw error;
      }

      const status = repositoryIndexStatus(workspace, config);
      const currentGeneration = Number(status.metadata?.generation || 0);
      const expectedGeneration = Number(index.generation || 0);
      const changedDuringQuery = status.dirty === true
        || (currentGeneration > 0 && expectedGeneration > 0 && currentGeneration !== expectedGeneration);
      if (!changedDuringQuery) return result;
      if (attempt + 1 < MAX_INDEXED_QUERY_ATTEMPTS) continue;

      const error = new Error('Repository changed while Repository Intelligence was answering the query. Retry against the refreshed index.');
      error.code = 'QUERY_SOURCE_CHANGED';
      throw error;
    }
    throw new Error('Repository Intelligence query retry budget exhausted.');
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
