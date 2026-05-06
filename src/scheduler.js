const fs = require("node:fs");
const path = require("node:path");
const { getStateDir } = require("./audit");
const { safeReadJson } = require("./safety");
const multiagent = require("./multiagent");

function schedulerDir(config) {
  return path.join(getStateDir(config), "scheduler");
}

function schedulerPath(config, id) {
  return path.join(schedulerDir(config), `${String(id || "default").replace(/[^A-Za-z0-9_.-]/g, "-")}.json`);
}

function dependencyReady(subtask, byRole, byId) {
  const deps = Array.isArray(subtask.dependsOn) ? subtask.dependsOn : [];
  const blockers = deps.filter((dep) => {
    const match = byId.get(dep) || byRole.get(dep);
    return match && !["completed", "reviewed", "merged"].includes(match.status);
  });
  return { ready: blockers.length === 0, blockers };
}

function computeSchedule(config, args = {}) {
  const parentSessionId = args.parentSessionId;
  const subtasks = multiagent.listSubtasks(config, { parentSessionId, limit: args.limit || 1000 });
  const byId = new Map(subtasks.map((item) => [item.id, item]));
  const byRole = new Map(subtasks.map((item) => [item.role, item]));
  const states = subtasks.map((item) => {
    const dep = dependencyReady(item, byRole, byId);
    const terminal = ["completed", "reviewed", "merged", "cancelled"].includes(item.status);
    const runnable = !terminal && dep.ready && !["running", "in-progress"].includes(item.status);
    return { ...item, runnable, blockers: dep.blockers };
  });
  const maxParallel = Math.min(Math.max(Number(args.maxParallel || config.multiAgent?.maxParallelSubtasks || 3), 1), 50);
  const running = states.filter((item) => ["running", "in-progress"].includes(item.status));
  const availableSlots = Math.max(0, maxParallel - running.length);
  const runnable = states.filter((item) => item.runnable).slice(0, availableSlots);
  const blocked = states.filter((item) => !item.runnable && item.blockers && item.blockers.length);
  const done = states.filter((item) => ["completed", "reviewed", "merged"].includes(item.status));
  return { ok: true, parentSessionId: parentSessionId || null, maxParallel, running, runnable, blocked, done, all: states };
}

function startScheduler(config, args = {}) {
  const schedule = computeSchedule(config, args);
  const record = {
    id: args.schedulerId || `sched-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    parentSessionId: args.parentSessionId || null,
    maxParallel: schedule.maxParallel,
    runnableSubtaskIds: schedule.runnable.map((item) => item.id),
    blockedSubtaskIds: schedule.blocked.map((item) => item.id)
  };
  fs.mkdirSync(schedulerDir(config), { recursive: true, mode: 0o700 });
  fs.writeFileSync(schedulerPath(config, record.id), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, scheduler: record, schedule };
}

function readScheduler(config, args = {}) {
  const id = args.schedulerId || "default";
  const file = schedulerPath(config, id);
  if (!fs.existsSync(file)) return { ok: false, schedulerId: id, message: "Scheduler record not found." };
  const scheduler = safeReadJson(file);
  if (!scheduler) return { ok: false, schedulerId: id, message: "Scheduler record corrupted." };
  return { ok: true, scheduler };
}

function updateScheduler(config, args = {}, status) {
  const id = args.schedulerId || "default";
  const current = fs.existsSync(schedulerPath(config, id))
    ? (safeReadJson(schedulerPath(config, id)) ?? { id, createdAt: new Date().toISOString() })
    : { id, createdAt: new Date().toISOString() };
  current.status = status;
  current.updatedAt = new Date().toISOString();
  if (args.reason) current.reason = String(args.reason);
  fs.mkdirSync(schedulerDir(config), { recursive: true, mode: 0o700 });
  fs.writeFileSync(schedulerPath(config, id), `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, scheduler: current };
}

module.exports = {
  computeSchedule,
  startScheduler,
  readScheduler,
  pauseScheduler: (config, args) => updateScheduler(config, args, "paused"),
  resumeScheduler: (config, args) => updateScheduler(config, args, "active"),
  stopScheduler: (config, args) => updateScheduler(config, args, "stopped")
};
