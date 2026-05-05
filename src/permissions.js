const ORDER = ["read-only", "patch", "test", "pr", "admin"];
const TOOL_LEVEL = {
  relai_version: "read-only",
  relai_config: "read-only",
  relai_audit_tail: "read-only",
  relai_task_list: "read-only",
  relai_task_read: "read-only",
  relai_workspace_tree: "read-only",
  relai_workspace_profile: "read-only",
  relai_read_files: "read-only",
  relai_search: "read-only",
  relai_context_pack: "read-only",
  relai_git_status: "read-only",
  relai_git_diff: "read-only",
  relai_git_log: "read-only",
  relai_git_show: "read-only",
  relai_job_status: "read-only",
  relai_job_list: "read-only",
  relai_task_start: "patch",
  relai_task_step: "patch",
  relai_task_update: "patch",
  relai_task_worktree_create: "patch",
  relai_worktree_list: "read-only",
  relai_write_file: "patch",
  relai_apply_patch: "patch",
  relai_create_branch: "patch",
  relai_switch_branch: "patch",
  relai_run_test: "test",
  relai_run_test_matrix: "test",
  relai_run_command: "test",
  relai_apply_patch_and_run: "test",
  relai_patch_test_loop: "test",
  relai_job_start_command: "test",
  relai_docker_run: "test",
  relai_commit_all: "pr",
  relai_push_branch: "pr",
  relai_create_pr: "pr",
  relai_pr_checks: "pr",
  relai_pr_watch_checks: "pr",
  relai_task_worktree_remove: "admin",
  relai_git_reset_worktree: "admin",
  relai_job_cancel: "admin"
};

function enforcePermission(config, toolName) {
  const configured = String(config.permissionProfile || "pr");
  const need = TOOL_LEVEL[toolName] || "admin";
  const current = ORDER.indexOf(configured);
  const required = ORDER.indexOf(need);
  if (current === -1) throw new Error(`Invalid permissionProfile '${configured}'. Use one of: ${ORDER.join(", ")}.`);
  if (current < required) throw new Error(`Tool '${toolName}' requires permission profile '${need}', current profile is '${configured}'.`);
}

module.exports = { enforcePermission, TOOL_LEVEL, ORDER };
