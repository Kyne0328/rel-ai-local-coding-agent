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

const SEMANTIC_SEARCH_TOTAL_TIMEOUT_MS = 30_000;

async function relaiSemanticSearch(workspace, config, args = {}, context = {}) {
  const deadline = createSemanticSearchDeadline(context);
  try {
    return await runSemanticSearch(workspace, config, args, { ...context, signal: deadline.signal });
  } catch (error) {
    if (deadline.didTimeout()) throw semanticSearchTimeoutError(deadline.timeoutMs);
    throw error;
  } finally {
    deadline.dispose();
  }
}

async function runSemanticSearch(workspace, config, args = {}, context = {}) {
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
    // Repository Intelligence owns a bounded four-worker global query budget. Match
    // that physical capacity so execution metrics describe real concurrent work.
    maxConcurrency: 4
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

function createSemanticSearchDeadline(context = {}) {
  const timeoutMs = positiveTimeout(context.semanticTimeoutMs, SEMANTIC_SEARCH_TOTAL_TIMEOUT_MS);
  const controller = new AbortController();
  const callerSignal = context.signal;
  let timedOut = false;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  else callerSignal?.addEventListener?.('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort(semanticSearchTimeoutError(timeoutMs));
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    timeoutMs,
    didTimeout: () => timedOut,
    dispose() {
      clearTimeout(timer);
      callerSignal?.removeEventListener?.('abort', onCallerAbort);
    }
  };
}

function semanticSearchTimeoutError(timeoutMs) {
  const error = new Error(`Semantic search exceeded ${timeoutMs}ms including index readiness and query execution.`);
  error.name = 'AbortError';
  error.code = 'QUERY_TIMEOUT';
  return error;
}

function positiveTimeout(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export { SEMANTIC_SEARCH_TOTAL_TIMEOUT_MS, relaiSemanticSearch };
