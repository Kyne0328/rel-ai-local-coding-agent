'use strict';

const {
  relaiReplace,
  relaiWrite,
  relaiApplyPatch,
  STAGED_WRITE_BYTE_THRESHOLD,
  STAGED_WRITE_LINE_THRESHOLD
} = require('./localRepoBridge');

const STAGED_CHUNK_BYTES = 12000;

async function runStagedWrite(workspace, config, args) {
  const content = args.content;
  const chunks = [];
  let offset = 0;
  while (offset < content.length) {
    chunks.push(content.slice(offset, offset + STAGED_CHUNK_BYTES));
    offset += STAGED_CHUNK_BYTES;
  }
  const startResult = relaiWrite(workspace, config, { stage: 'start', path: args.path, content: chunks[0], dryRun: args.dryRun });
  const { writeId } = startResult;
  for (let i = 1; i < chunks.length; i++) {
    relaiWrite(workspace, config, { stage: 'append', writeId, content: chunks[i] });
  }
  return relaiWrite(workspace, config, { stage: 'commit', writeId, dryRun: args.dryRun });
}

async function planEdit(workspace, config, args) {
  const hasOldText = typeof args.oldText === 'string' && args.oldText.length > 0;
  const hasContent = typeof args.content === 'string';
  const hasUpdateText = typeof args.updateText === 'string' && args.updateText.length > 0;

  // Ambiguous: both oldText and content provided
  if (hasOldText && hasContent) {
    throw new Error('relai_edit: ambiguous — provide oldText+newText for exact replacement OR content for full-file write, not both');
  }

  // No intent provided
  if (!hasOldText && !hasContent && !hasUpdateText) {
    throw new Error('relai_edit: must provide one of: (1) oldText+newText for exact replacement, (2) content for full-file write, (3) updateText for patch-shaped update');
  }

  // Replace path: oldText provided, no content
  if (hasOldText && !hasContent) {
    const result = relaiReplace(workspace, config, {
      path: args.path,
      oldText: args.oldText,
      newText: args.newText,
      dryRun: args.dryRun
    });
    return {
      ...result,
      plannerPath: 'replace',
      plannerReason: 'oldText provided without content — routing to exact text replacement'
    };
  }

  // Write path: content provided, no oldText
  if (hasContent && !hasOldText) {
    const contentBytes = Buffer.byteLength(args.content, 'utf8');
    const lineCount = args.content.split(/\r?\n/).length;
    const useStaged = contentBytes > STAGED_WRITE_BYTE_THRESHOLD || lineCount > STAGED_WRITE_LINE_THRESHOLD;

    if (useStaged) {
      const result = await runStagedWrite(workspace, config, args);
      return {
        ...result,
        plannerPath: 'write:staged',
        plannerReason: `content is large (${contentBytes} bytes, ${lineCount} lines) — routing to staged chunked write`
      };
    } else {
      const result = relaiWrite(workspace, config, {
        path: args.path,
        content: args.content,
        dryRun: args.dryRun
      });
      return {
        ...result,
        plannerPath: 'write',
        plannerReason: `content is small (${contentBytes} bytes, ${lineCount} lines) — routing to direct full-file write`
      };
    }
  }

  // Apply-update path: updateText provided
  if (hasUpdateText) {
    const result = await relaiApplyPatch(workspace, config, { ...args, patch: args.updateText });
    return {
      ...result,
      plannerPath: 'apply-update',
      plannerReason: 'updateText provided — routing to patch-shaped apply-update'
    };
  }

  // Should not be reached
  throw new Error('relai_edit: internal routing error — no path matched');
}

module.exports = { planEdit };
