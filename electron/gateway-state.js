function createGatewayState(initial = {}) {
  let current = freezeSnapshot({
    state: 'offline',
    principalPaired: false,
    deviceId: '',
    principalId: '',
    pairing: null,
    schemaVersion: null,
    manifestHash: '',
    schemaStatus: '',
    minimumProtocolVersion: null,
    currentProtocolVersion: null,
    observedAt: null,
    lastConnectedAt: null,
    lastRequestAt: null,
    reconnectAttempt: 0,
    error: '',
    ...initial
  });

  function snapshot() {
    return current;
  }

  function update(patch = {}) {
    current = freezeSnapshot({ ...current, ...patch });
    return current;
  }

  return Object.freeze({ snapshot, update });
}

function freezeSnapshot(value) {
  const pairing = value.pairing && typeof value.pairing === 'object'
    ? Object.freeze({ ...value.pairing })
    : null;
  return Object.freeze({ ...value, pairing });
}

export { createGatewayState };
