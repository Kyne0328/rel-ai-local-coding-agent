const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getStateDir } = require("./audit");
const sessions = require("./sessions");
const { safeReadJson } = require("./safety");

function plansDir(config) {
  return path.join(getStateDir(config), "plans");
}

function makePlanId() {
  return `plan-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

function validatePlanId(planId) {
  const id = String(planId || "").trim();
  if (!/^plan-[A-Za-z0-9_.-]{10,140}$/.test(id)) throw new Error(`Invalid plan id: ${id}`);
  return id;
}

function planPath(config, planId) {
  return path.join(plansDir(config), `${validatePlanId(planId)}.json`);
}

function normalizeStep(step, index) {
  return {
    id: step.id || `step-${index + 1}`,
    status: step.status || "pending",
    title: String(step.title || `Step ${index + 1}`).slice(0, 200),
    details: String(step.details || "").slice(0, 10000),
    toolHint: step.toolHint ? String(step.toolHint).slice(0, 200) : "",
    resultSummary: step.resultSummary ? String(step.resultSummary).slice(0, 10000) : "",
    data: step.data && typeof step.data === "object" ? step.data : {}
  };
}

function writePlan(config, plan) {
  fs.mkdirSync(plansDir(config), { recursive: true, mode: 0o700 });
  plan.updatedAt = new Date().toISOString();
  fs.writeFileSync(planPath(config, plan.id), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  return plan;
}

function createPlan(config, args = {}) {
  const now = new Date().toISOString();
  if (args.sessionId) sessions.readSession(config, args.sessionId);
  const rawSteps = Array.isArray(args.steps) ? args.steps : [];
  const plan = {
    id: makePlanId(),
    status: "draft",
    sessionId: args.sessionId ? String(args.sessionId) : null,
    workspace: args.workspace ? String(args.workspace) : null,
    title: String(args.title || "Rel.AI MCP task plan").slice(0, 200),
    goal: String(args.goal || "").slice(0, 20000),
    createdAt: now,
    updatedAt: now,
    steps: rawSteps.map((step, index) => normalizeStep(step || {}, index)),
    risks: Array.isArray(args.risks) ? args.risks.map((risk) => String(risk).slice(0, 1000)) : [],
    validation: Array.isArray(args.validation) ? args.validation.map((item) => String(item).slice(0, 1000)) : []
  };
  if (!plan.goal.trim()) throw new Error("plan goal is required.");
  const saved = writePlan(config, plan);
  if (saved.sessionId) {
    sessions.appendStep(config, { sessionId: saved.sessionId, type: "plan", title: "Created task plan", details: JSON.stringify(saved, null, 2), data: { ok: true, planId: saved.id } });
  }
  return saved;
}

function readPlan(config, planId) {
  const file = planPath(config, planId);
  if (!fs.existsSync(file)) throw new Error(`Plan not found: ${planId}`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Plan file corrupted: ${planId}`);
  return data;
}

function listPlans(config, options = {}) {
  const dir = plansDir(config);
  if (!fs.existsSync(dir)) return [];
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), 500);
  const sessionId = options.sessionId ? String(options.sessionId) : "";
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch (_error) { return null; }
    })
    .filter(Boolean)
    .filter((plan) => !sessionId || plan.sessionId === sessionId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit)
    .map((plan) => ({
      id: plan.id,
      status: plan.status,
      sessionId: plan.sessionId,
      workspace: plan.workspace,
      title: plan.title,
      goal: plan.goal,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0,
      completedSteps: (plan.steps || []).filter((step) => step.status === "done").length
    }));
}

function updatePlan(config, args = {}) {
  const plan = readPlan(config, args.planId);
  if (args.status) plan.status = String(args.status);
  if (Object.prototype.hasOwnProperty.call(args, "title")) plan.title = String(args.title || "").slice(0, 200);
  if (Object.prototype.hasOwnProperty.call(args, "goal")) plan.goal = String(args.goal || "").slice(0, 20000);
  if (Array.isArray(args.risks)) plan.risks = args.risks.map((risk) => String(risk).slice(0, 1000));
  if (Array.isArray(args.validation)) plan.validation = args.validation.map((item) => String(item).slice(0, 1000));
  return writePlan(config, plan);
}

function updatePlanStep(config, args = {}) {
  const plan = readPlan(config, args.planId);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const stepId = String(args.stepId || "");
  const index = stepId ? steps.findIndex((step) => step.id === stepId) : Number(args.index || 0) - 1;
  if (index < 0 || index >= steps.length) throw new Error("Plan step not found.");
  const step = steps[index];
  if (args.status) step.status = String(args.status);
  if (Object.prototype.hasOwnProperty.call(args, "title")) step.title = String(args.title || "").slice(0, 200);
  if (Object.prototype.hasOwnProperty.call(args, "details")) step.details = String(args.details || "").slice(0, 10000);
  if (Object.prototype.hasOwnProperty.call(args, "resultSummary")) step.resultSummary = String(args.resultSummary || "").slice(0, 10000);
  if (args.data && typeof args.data === "object") step.data = args.data;
  steps[index] = step;
  plan.steps = steps;
  if (plan.sessionId) {
    sessions.appendStep(config, { sessionId: plan.sessionId, type: "plan-step", title: `Updated plan step: ${step.title}`, details: JSON.stringify(step, null, 2), data: { ok: true, planId: plan.id, stepId: step.id, status: step.status } });
  }
  return writePlan(config, plan);
}

function appendPlanStep(config, args = {}) {
  const plan = readPlan(config, args.planId);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  steps.push(normalizeStep(args.step || args, steps.length));
  plan.steps = steps;
  return writePlan(config, plan);
}

module.exports = {
  createPlan,
  readPlan,
  listPlans,
  updatePlan,
  updatePlanStep,
  appendPlanStep
};
