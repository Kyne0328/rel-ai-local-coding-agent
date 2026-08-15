import { repositoryIntelligence } from '../repository/intelligence/service.js';
import {
  compactBatchResult,
  enforceBatchBudgets,
  resolveBatchLimit,
  resolveQueryTerms,
  runQueryBatch,
  splitBatchLimit,
  summarizeBatchResults
} from './queryBatch.js';

async function relaiSemanticSearch(workspace, config, args = {}, context = {}) {
  const { batched, terms } = resolveQueryTerms(args, {
    singleField: 'query',
    label: 'semantic search',
    maxLength: 2000,
    maxItems: 4
  });
  if (!batched) {
    return repositoryIntelligence.semanticSearch(workspace, config, args, { signal: context.signal, watch: context.watch });
  }

  const totalMaxResults = resolveBatchLimit(args.maxResults, { min: 1, max: 100, fallback: 40 });
  const totalMaxBytes = resolveBatchLimit(args.maxBytes, { min: 1000, max: 393216, fallback: 393216 });
  const maxResults = splitBatchLimit(totalMaxResults, {
    min: 1,
    max: 100,
    fallback: 40,
    count: terms.length
  });
  const maxBytes = splitBatchLimit(totalMaxBytes, {
    min: 1000,
    max: 393216,
    fallback: 393216,
    count: terms.length
  });
  const batch = await runQueryBatch(terms, query => repositoryIntelligence.semanticSearch(
    workspace,
    config,
    { ...args, query, queries: undefined, maxResults, maxBytes },
    { signal: context.signal, watch: context.watch }
  ), {
    signal: context.signal,
    kind: 'search-semantic',
    // Repository Intelligence owns a bounded two-reader pool per index. Match that
    // physical capacity so execution metrics describe real SQLite read overlap.
    maxConcurrency: 2
  });
  const results = enforceBatchBudgets(batch.results, { maxResults: totalMaxResults, maxBytes: totalMaxBytes });
  return {
    ok: true,
    workspace: workspace.alias,
    queries: terms,
    queryCount: terms.length,
    maxBytes: totalMaxBytes,
    execution: batch.metrics,
    results: results.map(compactBatchResult),
    ...summarizeBatchResults(results),
    strategy: 'batched-hybrid-read-pool',
    next: 'Batched semantic search completed in one call. Inspect only the strongest returned candidates before widening the search.'
  };
}

export { relaiSemanticSearch };
