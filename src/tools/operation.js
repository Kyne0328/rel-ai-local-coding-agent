'use strict';

const { redactCommandForAudit } = require('../bridge/exec');

function describeToolOperation(name, args = {}) {
  const workspace = String(args.workspace || '').trim();
  const path = String(args.path || '').trim();
  const suffix = workspace ? ` in ${workspace}` : '';
  switch (name) {
    case 'relai_start_task': return workspace ? `Resolving workspace ${workspace} for a new logical task` : 'Resolving workspace for a new logical task';
    case 'relai_repo_snapshot': return `Scanning the repository${suffix}`;
    case 'relai_read': {
      const paths = Array.isArray(args.paths) ? args.paths.filter(Boolean) : [];
      if (paths.length === 1) return `Reading ${paths[0]}${suffix}`;
      return `Reading ${paths.length || 'workspace'} paths${suffix}`;
    }
    case 'relai_search': return `Searching for ${String(args.pattern || '').slice(0, 60) || 'a pattern'}${suffix}`;
    case 'relai_code_inspect': return `Inspecting code relationships${suffix}`;
    case 'relai_exec': return `Running ${redactCommandForAudit(args.command) || 'a workspace command'}${suffix}`;
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
    case 'relai_ui_check': return `Running UI check ${args.check || '(unnamed)'}${suffix}`;
    case 'relai_diff': return `Reviewing repository changes${suffix}`;
    case 'relai_restore_paths': return `Restoring ${Array.isArray(args.paths) ? args.paths.length : 0} tracked paths${suffix}`;
    case 'relai_reset_workspace': return args.removeUntracked ? `Resetting and cleaning the workspace${suffix}` : `Resetting tracked workspace changes${suffix}`;
    case 'relai_git_commit': return `Creating a Git commit${suffix}`;
    case 'relai_git_push': return `Publishing the current branch${suffix}`;
    case 'relai_git_draft_pr': return `Preparing local pull request text${suffix}`;
    case 'relai_status': return workspace ? `Reading workspace and repository status for ${workspace}` : 'Reading Rel.AI status';
    case 'relai_complete_task': return `Reporting task completion${suffix}`;
    default: return `Running ${String(name || 'Rel.AI tool').replace(/^relai_/, '').replaceAll('_', ' ')}`;
  }
}

module.exports = { describeToolOperation };
