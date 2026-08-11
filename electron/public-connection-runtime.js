function createPublicConnectionRuntime({
  createGatewayConnection,
  prepareDirect,
  startDirect,
  stopDirect,
  onStatus = () => {}
} = {}) {
  if (typeof createGatewayConnection !== 'function') throw new TypeError('createGatewayConnection is required.');
  if (typeof prepareDirect !== 'function') throw new TypeError('prepareDirect is required.');
  if (typeof startDirect !== 'function') throw new TypeError('startDirect is required.');
  if (typeof stopDirect !== 'function') throw new TypeError('stopDirect is required.');
  if (typeof onStatus !== 'function') throw new TypeError('onStatus must be a function.');

  let activeMode = '';
  let gatewayConnection = null;
  let directProcess = null;
  let lifecycleGeneration = 0;

  function ownsGeneration(generation, mode) {
    return lifecycleGeneration === generation && activeMode === mode;
  }

  async function start(config = {}) {
    if (activeMode) throw new Error('Public connection runtime is already started.');
    const mode = String(config.connectionMode || '').trim();
    const generation = ++lifecycleGeneration;
    if (mode === 'cloud') {
      let connection = null;
      connection = createGatewayConnection({
        config,
        onStatus: status => {
          if (ownsGeneration(generation, 'cloud') && gatewayConnection === connection) {
            onStatus({ mode: 'cloud', status });
          }
        }
      });
      if (!connection || typeof connection.start !== 'function' || typeof connection.stop !== 'function') {
        throw new TypeError('createGatewayConnection must return start/stop controls.');
      }
      gatewayConnection = connection;
      activeMode = 'cloud';
      try {
        const status = await connection.start();
        if (!ownsGeneration(generation, 'cloud') || gatewayConnection !== connection) {
          await connection.stop().catch(() => {});
          return { mode: 'cloud', status: null, process: null, cancelled: true };
        }
        return { mode: 'cloud', status, process: null };
      } catch (error) {
        if (ownsGeneration(generation, 'cloud') && gatewayConnection === connection) {
          gatewayConnection = null;
          activeMode = '';
        }
        throw error;
      }
    }
    if (mode !== 'direct') throw new Error('Connection mode must be cloud or direct.');

    activeMode = 'direct';
    let ownedDirectProcess = null;
    try {
      await prepareDirect(config);
      const result = await startDirect(config, {
        onProcess(child) {
          ownedDirectProcess = child || null;
          if (ownsGeneration(generation, 'direct')) directProcess = ownedDirectProcess;
          else if (child) void stopDirect(child).catch(() => {});
        }
      });
      if (!ownsGeneration(generation, 'direct')) {
        const child = result?.process || ownedDirectProcess;
        if (child) await stopDirect(child).catch(() => {});
        return { mode: 'direct', ...result, process: null, cancelled: true };
      }
      if (!result?.ok) {
        activeMode = '';
        directProcess = null;
        return { mode: 'direct', ...result, process: result?.process || null };
      }
      directProcess = result.process || ownedDirectProcess || null;
      return { mode: 'direct', ...result, process: directProcess };
    } catch (error) {
      if (ownsGeneration(generation, 'direct')) {
        activeMode = '';
        directProcess = null;
      }
      throw error;
    }
  }

  async function stop() {
    lifecycleGeneration += 1;
    const mode = activeMode;
    const ownedGateway = gatewayConnection;
    const ownedDirect = directProcess;
    activeMode = '';
    gatewayConnection = null;
    directProcess = null;

    if (mode === 'cloud') {
      const status = ownedGateway ? await ownedGateway.stop() : null;
      return { mode: 'cloud', stopped: true, status };
    }
    if (mode === 'direct') {
      const result = ownedDirect ? await stopDirect(ownedDirect) : { exited: true, forced: false };
      return { mode: 'direct', stopped: true, ...result };
    }
    return { mode: '', stopped: true };
  }

  function snapshot() {
    return {
      mode: activeMode,
      gatewayConnected: Boolean(gatewayConnection),
      directProcessOwned: Boolean(directProcess),
      lifecycleGeneration
    };
  }

  function gatewaySnapshot() {
    return activeMode === 'cloud' && gatewayConnection ? gatewayConnection.snapshot() : null;
  }

  function gatewayCall(method, ...args) {
    const allowed = new Set(['beginPairing', 'cancelPairing', 'listDevices', 'revokeDevice', 'createDeviceLink', 'requestUsage']);
    if (!allowed.has(method)) throw new Error('Unsupported gateway control.');
    if (activeMode !== 'cloud' || !gatewayConnection) throw new Error('Rel.AI Cloud is not active.');
    const action = gatewayConnection[method];
    if (typeof action !== 'function') throw new Error('Gateway control is unavailable.');
    return action(...args);
  }

  return Object.freeze({ start, stop, snapshot, gatewaySnapshot, gatewayCall });
}

export { createPublicConnectionRuntime };
