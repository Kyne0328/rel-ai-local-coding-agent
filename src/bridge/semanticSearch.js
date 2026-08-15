import { repositoryIntelligence } from '../repository/intelligence/service.js';
import { compactBatchResult, resolveQueryTerms, runQueryBatch, splitBatchLimit, summarizeBatchResults } from './queryBatch.js';

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

  const maxResults = splitBatchLimit(args.maxResults, {
    min: 1,
    max: 100,
    fallback: 40,
    count: terms.length
  });
  const maxBytes = splitBatchLimit(args.maxBytes, {
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
  ), { signal: context.signal });
  const results = batch.results;
  return {
    ok: true,
    workspace: workspace.alias,
    queries: terms,
    queryCount: terms.length,
    execution: batch.metrics,
    results: results.map(compactBatchResult),
    ...summarizeBatchResults(results),
    strategy: 'batched-hybrid',
    next: 'Batched semantic search completed in one call. Inspect only the strongest returned candidates before widening the search.'
  };
}

export { relaiSemanticSearch };
