import { parentPort } from 'node:worker_threads';

import { cachedRepositoryContext, cachedRepositorySummary, cachedSearchGraphContext } from './contextPlanner.js';
import { executeCodeInspectQuery, executeSemanticSearchQuery } from './queryService.js';

let activeJob = null;

parentPort?.on('message', message => {
  if (message?.type === 'abort') {
    if (activeJob?.jobId === message.jobId && !activeJob.controller.signal.aborted) {
      activeJob.controller.abort(new Error(String(message.reason || 'Repository Intelligence query cancelled.')));
    }
    return;
  }
  if (message?.type !== 'run') return;
  if (activeJob) {
    parentPort?.postMessage({
      type: 'result',
      jobId: message.jobId,
      ok: false,
      error: { name: 'Error', code: 'QUERY_WORKER_BUSY', message: 'Repository Intelligence query worker already has an active job.', stack: '' }
    });
    return;
  }
  void runJob(message.jobId, message.job || {});
});

async function runJob(jobId, job) {
  const controller = new AbortController();
  activeJob = { jobId, controller };
  try {
    const options = {
      ...(job.options || {}),
      signal: controller.signal,
      repositoryStatuses: job.repositoryStatuses || {}
    };
    let result;
    if (job.kind === 'codeInspect') {
      result = await executeCodeInspectQuery(job.workspace, job.config, job.args, job.index, options);
    } else if (job.kind === 'semanticSearch') {
      result = await executeSemanticSearchQuery(job.workspace, job.config, job.args, job.index, options);
    } else if (job.kind === 'cachedContext') {
      result = cachedRepositoryContext(job.workspace, job.config, { ...(job.options || {}), repositoryStatuses: options.repositoryStatuses });
    } else if (job.kind === 'cachedSummary') {
      result = cachedRepositorySummary(job.workspace, job.config, { ...(job.options || {}), repositoryStatuses: options.repositoryStatuses });
    } else if (job.kind === 'searchGraphContext') {
      result = cachedSearchGraphContext(job.workspace, job.config, job.matches || [], { repositoryStatuses: options.repositoryStatuses });
    } else {
      throw Object.assign(new Error(`Unknown Repository Intelligence query job: ${String(job.kind || '')}`), { code: 'QUERY_JOB_UNKNOWN' });
    }
    parentPort?.postMessage({ type: 'result', jobId, ok: true, result });
  } catch (error) {
    parentPort?.postMessage({
      type: 'result',
      jobId,
      ok: false,
      error: {
        name: String(error?.name || 'Error'),
        code: error?.code == null ? '' : String(error.code),
        message: String(error?.message || error || 'Repository Intelligence query worker failed.'),
        stack: typeof error?.stack === 'string' ? error.stack : ''
      }
    });
  } finally {
    if (activeJob?.jobId === jobId) activeJob = null;
  }
}
