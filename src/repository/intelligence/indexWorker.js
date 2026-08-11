import { parentPort } from 'node:worker_threads';

import { executeRepositoryIndexJob } from './indexBuild.js';

let activeJob = null;

parentPort?.on('message', message => {
  if (message?.type === 'abort') {
    if (activeJob?.jobId === message.jobId && !activeJob.controller.signal.aborted) {
      activeJob.controller.abort(new Error(String(message.reason || 'Repository Intelligence worker cancelled.')));
    }
    return;
  }
  if (message?.type !== 'run') return;
  if (activeJob) {
    parentPort?.postMessage({
      type: 'result',
      jobId: message.jobId,
      ok: false,
      error: { name: 'Error', code: 'INDEX_WORKER_BUSY', message: 'Repository Intelligence worker already has an active job.', stack: '' }
    });
    return;
  }
  void runJob(message.jobId, message.job || {});
});

async function runJob(jobId, job) {
  const controller = new AbortController();
  activeJob = { jobId, controller };
  try {
    const result = await executeRepositoryIndexJob(job, controller.signal);
    parentPort?.postMessage({ type: 'result', jobId, ok: true, result });
  } catch (error) {
    parentPort?.postMessage({
      type: 'result',
      jobId,
      ok: false,
      error: {
        name: String(error?.name || 'Error'),
        code: error?.code == null ? '' : String(error.code),
        message: String(error?.message || error || 'Repository Intelligence worker failed.'),
        stack: typeof error?.stack === 'string' ? error.stack : ''
      }
    });
  } finally {
    if (activeJob?.jobId === jobId) activeJob = null;
  }
}
