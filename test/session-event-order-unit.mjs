import assert from 'node:assert/strict';
import { orderSessionEvents } from '../src/ui/features/sessions/index.js';

const events = [
  { id: 'oldest', ts: '2026-07-25T10:00:00.000Z' },
  { id: 'newest', ts: '2026-07-25T10:02:00.000Z' },
  { id: 'middle', ts: '2026-07-25T10:01:00.000Z' },
  { id: 'fallback', createdAt: '2026-07-25T09:59:00.000Z' }
];

const ordered = orderSessionEvents(events);
assert.deepEqual(ordered.map(event => event.id), ['newest', 'middle', 'oldest', 'fallback']);
assert.deepEqual(events.map(event => event.id), ['oldest', 'newest', 'middle', 'fallback'], 'ordering must not mutate stored session events');

console.log('Session event ordering tests passed.');
