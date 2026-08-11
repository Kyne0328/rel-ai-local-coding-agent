

import * as path from "node:path";

const DEFAULT_STAGED_CHUNK_BYTES = 12000;
const STAGED_WRITE_BYTE_THRESHOLD = 8000;
const STAGED_WRITE_LINE_THRESHOLD = 180;
const SOURCE_LIKE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.dart', '.py', '.go', '.rs',
  '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php',
  '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.json', '.md'
]);

function workspaceWriteGuidance() {
  return {
    defaultMode: 'size-based',
    recommendedChunkBytes: DEFAULT_STAGED_CHUNK_BYTES,
    modes: {
      'exact-replace': {
        tool: 'relai_edit',
        when: [
          'localized edits inside existing files',
          'large source files',
          'template-heavy or interpolation-heavy files',
          'duplicate import cleanup, lint-only text edits, and focused behavior changes'
        ]
      },
      'direct-write': {
        tool: 'relai_edit',
        when: [
          'complete replacement of a small or normal-sized file',
          `whole-file content under about ${STAGED_WRITE_BYTE_THRESHOLD} bytes and ${STAGED_WRITE_LINE_THRESHOLD} lines`
        ]
      },
      'staged-write': {
        tool: 'relai_edit',
        when: [
          'complete replacement of a large file',
          `whole-file content above about ${STAGED_WRITE_BYTE_THRESHOLD} bytes or ${STAGED_WRITE_LINE_THRESHOLD} lines`
        ],
        chunkBytes: DEFAULT_STAGED_CHUNK_BYTES
      },
      'apply-update': {
        tool: 'relai_edit',
        when: [
          'a multi-file change is already represented as a unified patch (pass updateText)',
          'several related files need coordinated text edits (pass edits: [...])'
        ]
      },
      'workspace-tidy': {
        tools: ['relai_changes', 'relai_changes'],
        when: ['generated session artifacts should be tidied through a bounded plan']
      }
    },
    selectionOrder: [
      'Use exact-replace for small edits inside existing files.',
      'Use direct-write for complete replacement of small or normal-sized files.',
      'Use staged-write for complete replacement of large files.',
      'Use apply-update when the change is naturally patch-shaped across files.',
      'Use workspace-tidy plan/run for generated session artifacts.'
    ],
    examples: {
      exactReplace: 'relai_edit { work_id, path, expectedSha256?, oldText, newText, occurrence? }',
      directWrite: 'relai_edit { work_id, path, expectedSha256?, content }',
      stagedWriteStart: "relai_edit { work_id, stage: 'start', path, expectedSha256?, content }",
      stagedWriteAppend: "relai_edit { work_id, stage: 'append', writeId, content }",
      stagedWriteCommit: "relai_edit { work_id, stage: 'commit', writeId }",
      applyUpdate: 'relai_edit { work_id, updateText, returnDiff: true }',
      workspaceTidyPlan: "relai_changes { action: 'tidy_plan', work_id, mode: 'session_untracked' }",
      workspaceTidyRun: "relai_changes { action: 'tidy_run', work_id, planId }"
    },
    next: 'Choose the edit shape by task and file size. Use workflow guidance to decide when validation is useful; runChecks remains explicit.'
  };
}

function analyzeFileShape(relativePath, text) {
  const bytes = Buffer.byteLength(text, 'utf8');
  const lineCount = countLines(text);
  const ext = path.extname(relativePath).toLowerCase();
  const interpolationMarkers = countMatches(text, /\$\{|\{\{/g);
  const reasons = [];
  if (bytes >= STAGED_WRITE_BYTE_THRESHOLD) reasons.push(`file is ${bytes} bytes`);
  if (lineCount >= STAGED_WRITE_LINE_THRESHOLD) reasons.push(`file has ${lineCount} lines`);
  if (SOURCE_LIKE_EXTENSIONS.has(ext) && (interpolationMarkers >= 4 || (interpolationMarkers >= 1 && bytes >= 4000))) {
    reasons.push(`source contains dense template/interpolation syntax (${interpolationMarkers} markers)`);
  }
  return { bytes, lineCount, ext, interpolationMarkers, reasons };
}

function fileWriteGuidance(relativePath, text) {
  const shape = analyzeFileShape(relativePath, text);
  const fileShape = {
    bytes: shape.bytes,
    lineCount: shape.lineCount,
    extension: shape.ext || '',
    interpolationMarkers: shape.interpolationMarkers
  };
  if (shape.reasons.length) {
    return {
      recommendedMode: 'exact-replace',
      tool: 'relai_edit',
      fallbackMode: 'staged-write',
      fallbackTool: 'relai_edit',
      alternatives: ['staged-write', 'apply-update'],
      recommendedChunkBytes: DEFAULT_STAGED_CHUNK_BYTES,
      fileShape,
      reasons: shape.reasons,
      useWhen: 'Use for localized edits inside this existing file.',
      wholeFileReplacement: {
        recommendedMode: 'staged-write',
        tool: 'relai_edit',
        reason: 'Use staged content only when the complete file genuinely needs replacement.'
      },
      multiFileChange: {
        recommendedMode: 'apply-update',
        tool: 'relai_edit',
        reason: 'Use relai_edit with updateText (or edits: [...]) when the change spans multiple files.'
      },
      next: 'Use relai_edit with exact current text for localized changes or staged content for unavoidable whole-file replacement. Use relai_changes and relai_changes for session-owned untracked artifacts.'
    };
  }
  return {
    recommendedMode: 'direct-write',
    tool: 'relai_edit',
    fallbackMode: 'exact-replace',
    fallbackTool: 'relai_edit',
    alternatives: ['exact-replace', 'apply-update'],
    fileShape,
    reasons: ['normal-sized file'],
    useWhen: 'Use for complete replacement of this small or normal-sized file.',
    localizedEdit: {
      recommendedMode: 'exact-replace',
      tool: 'relai_edit',
      reason: 'Use oldText/newText or replacements when only a small block changes.'
    },
    multiFileChange: {
      recommendedMode: 'apply-update',
      tool: 'relai_edit',
      reason: 'Use relai_edit with updateText (or edits: [...]) when the change spans multiple files.'
    },
    next: 'Use relai_edit with content for full-file replacement, or exact replacement fields for localized edits.'
  };
}

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function countLines(text) {
  if (text === '') return 0;
  return String(text).split(/\r?\n/).length;
}

export { STAGED_WRITE_BYTE_THRESHOLD, STAGED_WRITE_LINE_THRESHOLD, workspaceWriteGuidance, analyzeFileShape, fileWriteGuidance };
