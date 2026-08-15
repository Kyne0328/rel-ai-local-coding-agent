function createShutdownCoordinator(options = {}) {
  const {
    stopService = async () => ({ cleanup: { clean: true } }),
    stopUpdater = () => {},
    stopActivity = () => {},
    closeWindows = () => {},
    removeRuntimeMarker = () => {},
    shutdownTelemetry = async () => {},
    markCleanShutdown = () => {},
    flushLogs = async () => {},
    onLog = () => {}
  } = options;
  let shutdownPromise = null;
  let prepared = false;

  function prepare(reason = 'quit') {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      const errors = [];
      runStep(stopUpdater, 'updater', errors);
      runStep(stopActivity, 'activity runtime', errors);
      runStep(closeWindows, 'windows', errors);

      let serviceResult = null;
      try {
        serviceResult = await stopService();
      } catch (error) {
        errors.push(stepError('service', error));
      }
      try {
        await shutdownTelemetry();
      } catch (error) {
        errors.push(stepError('telemetry', error));
      }
      runStep(removeRuntimeMarker, 'runtime marker', errors);

      const serviceClean = serviceResult?.cleanup?.clean !== false;
      const clean = errors.length === 0 && serviceClean;
      if (clean) runStep(markCleanShutdown, 'lifecycle marker', errors);
      prepared = true;

      for (const item of errors) {
        onLog(`Shutdown ${item.step} failed: ${item.message}`, {
          source: 'desktop-shutdown',
          level: 'warning',
          code: 'shutdown_cleanup_failed'
        });
      }
      if (!serviceClean) {
        onLog('Shutdown cleanup could not confirm that every owned process exited.', {
          source: 'desktop-shutdown',
          level: 'warning',
          code: 'shutdown_process_exit_unconfirmed'
        });
      }
      await flushLogs();
      return { ok: clean && errors.length === 0, clean, reason, errors, serviceResult };
    })();
    return shutdownPromise;
  }

  function isPrepared() {
    return prepared;
  }

  return { prepare, isPrepared };
}

function closeHttpServer(server, options = {}) {
  if (!server) return Promise.resolve({ closed: true, forced: false });
  const timeoutMs = Number(options.timeoutMs || 2500);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      Promise.resolve(server.waitForShutdown?.()).catch(() => {}).finally(() => resolve(value));
    };
    const timer = setTimeout(() => {
      try { server.closeAllConnections?.(); } catch {}
      finish({ closed: false, forced: true });
    }, timeoutMs);
    try {
      server.close(error => finish({
        closed: !error,
        forced: false,
        ...(error ? { error: errorMessage(error) } : {})
      }));
      server.closeIdleConnections?.();
    } catch (error) {
      finish({ closed: false, forced: false, error: errorMessage(error) });
    }
  });
}

function runStep(action, step, errors) {
  try {
    action();
  } catch (error) {
    errors.push(stepError(step, error));
  }
}

function stepError(step, error) {
  return {
    step,
    message: error instanceof Error ? error.message : String(error || 'Unknown error')
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export { closeHttpServer, createShutdownCoordinator };
