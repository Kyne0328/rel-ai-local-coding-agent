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

  async function start(config = {}) {
    if (activeMode) throw new Error('Public connection runtime is already started.');
    const mode = String(config.connectionMode || '').trim();
    if (mode === 'cloud') {
      const connection = createGatewayConnection({
        config,
        onStatus: status => onStatus({ mode: 'cloud', status })
      });
      if (!connection || typeof connection.start !== 'function' || typeof connection.stop !== 'function') {
        throw new TypeError('createGatewayConnection must return start/stop controls.');
      }
      gatewayConnection = connection;
      activeMode = 'cloud';
      try {
        const status = await connection.start();
        return { mode: 'cloud', status, process: null };
      } catch (error) {
        gatewayConnection = null;
        activeMode = '';
        throw error;
      }
    }
    if (mode !== 'direct') throw new Error('Connection mode must be cloud or direct.');

    activeMode = 'direct';
    try {
      await prepareDirect(config);
      const result = await startDirect(config, {
        onProcess(child) {
          if (activeMode === 'direct') directProcess = child || null;
          else if (child) void stopDirect(child).catch(() => {});
        }
      });
      if (!result?.ok) {
        if (activeMode === 'direct') activeMode = '';
        directProcess = null;
        return { mode: 'direct', ...result, process: result?.process || null };
      }
      if (activeMode !== 'direct') {
        const child = result.process || directProcess;
        if (child) await stopDirect(child).catch(() => {});
        return { mode: 'direct', ...result, process: null, cancelled: true };
      }
      directProcess = result.process || directProcess || null;
      return { mode: 'direct', ...result, process: directProcess };
    } catch (error) {
      if (activeMode === 'direct') activeMode = '';
      directProcess = null;
      throw error;
    }
  }

  async function stop() {
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
      directProcessOwned: Boolean(directProcess)
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
