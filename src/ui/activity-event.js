import { eventIdentityFields } from '../taskEvents.js';

export function activityEventId(entry = {}) {
  const identity = eventIdentityFields(entry, { preferId: true });
  return `event:${fnv1a64(JSON.stringify(identity))}`;
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
