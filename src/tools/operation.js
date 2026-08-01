

import { redactCommandForAudit } from "../bridge/exec.js";

function describeToolOperation(name, args = {}) {
  const workspace = String(args.workspace || '').trim();
  const path = String(args.path || '').trim();
  const suffix = workspace ? ` in ${workspace}` : '';
  switch (name) {
    case 'relai_begin_work': return workspace ? `Resolving workspace ${workspace} for a new logical task` : 'Resolving workspace for a new logical task';
    case 'relai_repo_snapshot': return `Scanning the repository${suffix}`;
    case 'relai_read': {
      const paths = Array.isArray(args.paths) ? args.paths.filter(Boolean) : [];
      if (paths.length === 1) return `Reading ${paths[0]}${suffix}`;
      return `Reading ${paths.length || 'workspace'} paths${suffix}`;
    }
    case 'relai_search': return `Searching for ${String(args.pattern || '').slice(0, 60) || 'a pattern'}${suffix}`;
    case 'relai_code_inspect': return `Inspecting code relationships${suffix}`;
    case 'relai_exec': return `Running ${redactCommandForAudit(args.command) || 'a workspace command'}${suffix}`;
    case 'relai_process_start': return `Starting managed process ${redactCommandForAudit(args.command) || '(unnamed)'}${suffix}`;
    case 'relai_process_read': return `Reading managed process ${args.processId || ''}`.trim();
    case 'relai_process_write': return `Sending input to managed process ${args.processId || ''}`.trim();
    case 'relai_process_stop': return `Stopping managed process ${args.processId || ''}`.trim();
    case 'relai_process_list': return workspace ? `Listing managed processes in ${workspace}` : 'Listing managed processes';
    case 'relai_worktree_create': return `Creating managed worktree ${args.name || ''}${suffix}`.trim();
    case 'relai_worktree_list': return workspace ? `Listing managed worktrees for ${workspace}` : 'Listing managed worktrees';
    case 'relai_worktree_remove': return `Removing managed worktree ${args.alias || ''}${suffix}`.trim();
    case 'relai_semantic_search': return `Semantically searching for ${String(args.query || '').slice(0, 60) || 'a concept'}${suffix}`;
    case 'relai_diagnostics_run': return `Running structured diagnostics${suffix}`;
    case 'relai_edit': {
      if (path) return `Editing ${path}${suffix}`;
      if (Array.isArray(args.edits)) return `Applying ${args.edits.length} file edits${suffix}`;
      if (args.updateText) return `Applying a workspace patch${suffix}`;
      return `Editing the workspace${suffix}`;
    }
    case 'relai_tidy_plan': return `Reviewing generated artifacts${suffix}`;
    case 'relai_tidy_run': return `Removing approved generated artifacts${suffix}`;
    case 'relai_run_checks': return `Running ${String(args.level || 'standard')} validation${suffix}`;
    case 'relai_http_probe': return `Probing local route ${args.route || '/'}${suffix}`;
    case 'relai_diff': return `Reviewing repository changes${suffix}`;
    case 'relai_restore_paths': return `Restoring ${Array.isArray(args.paths) ? args.paths.length : 0} tracked paths${suffix}`;
    case 'relai_reset_workspace': return args.removeUntracked ? `Resetting and cleaning the workspace${suffix}` : `Resetting tracked workspace changes${suffix}`;
    case 'relai_git_commit': return `Creating a Git commit${suffix}`;
    case 'relai_git_push': return `Publishing the current branch${suffix}`;
    case 'relai_git_draft_pr': return `Preparing local pull request text${suffix}`;
    case 'relai_status': return workspace ? `Reading workspace and repository status for ${workspace}` : 'Reading Rel.AI status';
    case 'relai_finish_work': return `Finalizing logical task${suffix}`;
    default: return `Running ${String(name || 'Rel.AI tool').replace(/^relai_/, '').replaceAll('_', ' ')}`;
  }
}

export { describeToolOperation };
