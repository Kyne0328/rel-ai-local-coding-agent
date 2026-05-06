const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { getStateDir } = require("./audit");
const { safeCommandPolicy, safeReadJson } = require("./safety");

const liveJobs = new Map();

function jobsDir(config) {
  return path.join(getStateDir(config), "jobs");
}

function makeJobId() {
  return `job-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

function validateJobId(jobId) {
  const id = String(jobId || "").trim();
  if (!/^job-[A-Za-z0-9_.-]{10,120}$/.test(id)) throw new Error(`Invalid job id: ${id}`);
  return id;
}

function jobPath(config, jobId) {
  return path.join(jobsDir(config), `${validateJobId(jobId)}.json`);
}

function readJob(config, jobId) {
  const file = jobPath(config, jobId);
  if (!fs.existsSync(file)) throw new Error(`Job not found: ${jobId}`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Job file corrupted: ${jobId}`);
  return data;
}

function writeJob(config, job) {
  fs.mkdirSync(jobsDir(config), { recursive: true, mode: 0o700 });
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(jobPath(config, job.id), `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
  return job;
}

function listJobs(config, options = {}) {
  const dir = jobsDir(config);
  if (!fs.existsSync(dir)) return [];
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), 500);
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        return {
          id: job.id,
          status: job.status,
          workspace: job.workspace,
          sessionId: job.sessionId || null,
          commandKey: job.commandKey || null,
          startedAt: job.startedAt,
          updatedAt: job.updatedAt,
          exitCode: job.exitCode
        };
      } catch (_error) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

function resolveCommand(workspace, args = {}) {
  if (args.testCommandKey) {
    const command = workspace.testCommands && workspace.testCommands[args.testCommandKey];
    if (!command) throw new Error(`Test command key '${args.testCommandKey}' is not configured for workspace '${workspace.alias}'.`);
    return { key: args.testCommandKey, kind: "test", command };
  }
  if (args.commandKey) {
    const command = workspace.commands && workspace.commands[args.commandKey];
    if (!command) throw new Error(`Command key '${args.commandKey}' is not configured for workspace '${workspace.alias}'.`);
    return { key: args.commandKey, kind: "command", command };
  }
  throw new Error("Use testCommandKey or commandKey for background jobs.");
}

function startCommandJob(config, workspace, args = {}) {
  const resolved = resolveCommand(workspace, args);
  safeCommandPolicy(resolved.command);
  const id = makeJobId();
  const dir = jobsDir(config);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stdoutPath = path.join(dir, `${id}.stdout.log`);
  const stderrPath = path.join(dir, `${id}.stderr.log`);
  const out = fs.openSync(stdoutPath, "a", 0o600);
  const err = fs.openSync(stderrPath, "a", 0o600);
  const now = new Date().toISOString();
  const job = writeJob(config, {
    id,
    status: "running",
    workspace: workspace.alias,
    workspacePath: workspace.path,
    sessionId: args.sessionId || null,
    commandKey: resolved.key,
    kind: resolved.kind,
    command: resolved.command,
    startedAt: now,
    updatedAt: now,
    stdoutPath,
    stderrPath,
    pid: null,
    exitCode: null,
    signal: null
  });

  const child = spawn(resolved.command, { cwd: workspace.path, shell: true, env: { ...process.env, REL_AI_MCP: "1" }, stdio: ["ignore", out, err] });
  job.pid = child.pid;
  writeJob(config, job);
  liveJobs.set(id, child);
  child.on("close", (code, signal) => {
    try {
      fs.closeSync(out);
      fs.closeSync(err);
    } catch (_error) {}
    liveJobs.delete(id);
    const latest = readJob(config, id);
    latest.status = code === 0 ? "succeeded" : "failed";
    latest.exitCode = typeof code === "number" ? code : -1;
    latest.signal = signal || null;
    latest.finishedAt = new Date().toISOString();
    writeJob(config, latest);
  });
  child.on("error", (error) => {
    liveJobs.delete(id);
    const latest = readJob(config, id);
    latest.status = "failed";
    latest.error = error.message;
    latest.finishedAt = new Date().toISOString();
    writeJob(config, latest);
  });
  return { ok: true, job: readJob(config, id) };
}

function jobStatus(config, args = {}) {
  const job = readJob(config, args.jobId);
  const tailBytes = Math.min(Math.max(Number(args.tailBytes || 12000), 0), 200000);
  return {
    ok: true,
    job,
    stdoutTail: tailBytes ? readTail(job.stdoutPath, tailBytes) : "",
    stderrTail: tailBytes ? readTail(job.stderrPath, tailBytes) : ""
  };
}

function cancelJob(config, args = {}) {
  const id = validateJobId(args.jobId);
  const child = liveJobs.get(id);
  if (!child) return { ok: false, job: readJob(config, id), message: "Job is not live in this server process." };
  child.kill(args.force === true ? "SIGKILL" : "SIGTERM");
  const job = readJob(config, id);
  job.status = "cancelling";
  writeJob(config, job);
  return { ok: true, job, message: "Cancellation signal sent." };
}

function readTail(file, bytes) {
  if (!file || !fs.existsSync(file)) return "";
  const stat = fs.statSync(file);
  const length = Math.min(bytes, stat.size);
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { startCommandJob, jobStatus, listJobs, cancelJob };
