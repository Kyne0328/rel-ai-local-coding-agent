'use strict';

// Structured batch edits are intentionally bounded separately from patch-shaped
// updates. Larger repository-wide changes should use updateText, which is bounded
// by the configured patch byte limit instead of a file-count limit.
const MAX_BATCH_EDITS = 100;
const MAX_BATCH_REPLACEMENTS = 500;
const MAX_BATCH_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const BATCH_RESULT_COMPACT_THRESHOLD = 20;

module.exports = {
  MAX_BATCH_EDITS,
  MAX_BATCH_REPLACEMENTS,
  MAX_BATCH_INPUT_BYTES,
  MAX_BATCH_SNAPSHOT_BYTES,
  BATCH_RESULT_COMPACT_THRESHOLD
};
