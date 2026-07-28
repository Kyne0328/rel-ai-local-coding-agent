export function createSnapshotGate() {
  let streamId = '';
  let sequence = 0;

  function accept(payload) {
    const snapshot = payload?.snapshot;
    if (!snapshot?.streamId || !Number.isFinite(Number(snapshot.sequence))) return true;
    if (streamId !== snapshot.streamId) {
      streamId = snapshot.streamId;
      sequence = Number(snapshot.sequence);
      return true;
    }
    if (Number(snapshot.sequence) <= sequence) return false;
    sequence = Number(snapshot.sequence);
    return true;
  }

  return {
    accept,
    state: () => ({ streamId, sequence }),
    reset() {
      streamId = '';
      sequence = 0;
    }
  };
}
