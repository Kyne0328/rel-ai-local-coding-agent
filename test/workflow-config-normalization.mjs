import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const {
  normalizeWorkflowConfig,
  makeDefaultWorkflowConfig,
  getWorkflowConfig,
  isPreparedWorkflow,
  normalizeConfig
} = require(path.join(__dirname, "..", "src", "config.js"));

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exit(1);
  }
}

// 1. missing workflow → mode = "standard"
test("missing workflow → mode = standard", () => {
  const result = normalizeWorkflowConfig(undefined, undefined);
  assert.equal(result.mode, "standard");
  assert.ok(result.prepared, "should have prepared sub-object");
});

// 2. workflow.mode = "conservative" → "standard"
test("workflow.mode = conservative → standard", () => {
  const result = normalizeWorkflowConfig({ mode: "conservative" });
  assert.equal(result.mode, "standard");
});

// 3. workflow.mode = "aggressive" → "prepared"
test("workflow.mode = aggressive → prepared", () => {
  const result = normalizeWorkflowConfig({ mode: "aggressive" });
  assert.equal(result.mode, "prepared");
});

// 4. workflow.aggressive migrates to workflow.prepared
test("workflow.aggressive migrates to workflow.prepared", () => {
  const result = normalizeWorkflowConfig({
    mode: "aggressive",
    aggressive: {
      requireCleanGit: false,
      backup: false,
      deleteMissingDefault: true,
      maxPatchBytes: 512 * 1024,
      maxArchiveBytes: 100 * 1024 * 1024
    }
  });
  assert.equal(result.mode, "prepared");
  assert.equal(result.prepared.requireCleanGit, false);
  assert.equal(result.prepared.backup, false);
  assert.equal(result.prepared.clearMissingDefault, true, "deleteMissingDefault → clearMissingDefault");
  assert.equal(result.prepared.maxUpdateBytes, 512 * 1024, "maxPatchBytes → maxUpdateBytes");
  assert.equal(result.prepared.maxBundleBytes, 100 * 1024 * 1024, "maxArchiveBytes → maxBundleBytes");
  assert.equal(result.prepared.aggressive, undefined, "should NOT have aggressive key");
});

// 5. flow.mode = "fast" → "prepared"
test("flow.mode = fast → prepared", () => {
  const result = normalizeWorkflowConfig(undefined, { mode: "fast" });
  assert.equal(result.mode, "prepared");
});

// 6. flow.fast migrates to workflow.prepared
test("flow.fast migrates to workflow.prepared", () => {
  const result = normalizeWorkflowConfig(undefined, {
    mode: "fast",
    fast: {
      requireCleanGit: false,
      backup: false,
      clearMissingDefault: true,
      maxPatchBytes: 1 * 1024 * 1024,
      maxArchiveBytes: 50 * 1024 * 1024
    }
  });
  assert.equal(result.mode, "prepared");
  assert.equal(result.prepared.requireCleanGit, false);
  assert.equal(result.prepared.backup, false);
  assert.equal(result.prepared.clearMissingDefault, true);
  assert.equal(result.prepared.maxUpdateBytes, 1 * 1024 * 1024, "flow.fast.maxPatchBytes → maxUpdateBytes");
  assert.equal(result.prepared.maxBundleBytes, 50 * 1024 * 1024, "flow.fast.maxArchiveBytes → maxBundleBytes");
});

// 7. invalid workflow mode → "standard"
test("invalid workflow mode → standard", () => {
  const result = normalizeWorkflowConfig({ mode: "bananas" });
  assert.equal(result.mode, "standard");
});

// 8. empty string mode → "standard"
test("empty string mode → standard", () => {
  const result = normalizeWorkflowConfig({ mode: "" });
  assert.equal(result.mode, "standard");
});

// 9. canonical output uses workflow.prepared (not workflow.aggressive)
test("canonical output uses workflow.prepared, not workflow.aggressive", () => {
  const result = normalizeWorkflowConfig({ mode: "prepared" });
  assert.ok("prepared" in result, "should have prepared key");
  assert.equal("aggressive" in result, false, "should NOT have aggressive key");
});

// 10. normalizeConfig with old flow top-level: config.workflow is the source of truth
test("normalizeConfig: config.workflow is source of truth (not config.flow)", () => {
  const raw = {
    stateDir: "/tmp/test-state",
    flow: { mode: "fast", fast: { backup: false } },
    workspaces: {}
  };
  const normalized = normalizeConfig(raw);
  // config.workflow must exist and be canonical
  assert.ok(normalized.workflow, "normalized config should have workflow");
  assert.equal(normalized.workflow.mode, "prepared", "flow.mode=fast should produce prepared");
  assert.equal(normalized.workflow.prepared.backup, false, "flow.fast.backup=false should carry over");
  // config.flow may still be present in the raw object but runtime reads config.workflow
  // The key test is that config.workflow.mode is set correctly, not config.flow
});

// 11. isPreparedWorkflow returns true for prepared, false for standard
test("isPreparedWorkflow returns true for prepared", () => {
  const config = { workflow: { mode: "prepared", prepared: {} } };
  assert.equal(isPreparedWorkflow(config), true);
});

test("isPreparedWorkflow returns false for standard", () => {
  const config = { workflow: { mode: "standard", prepared: {} } };
  assert.equal(isPreparedWorkflow(config), false);
});

test("isPreparedWorkflow returns false when workflow is missing", () => {
  const config = {};
  assert.equal(isPreparedWorkflow(config), false);
});

// 12. getWorkflowConfig returns default when workflow is missing
test("getWorkflowConfig returns default when workflow is missing", () => {
  const config = {};
  const wf = getWorkflowConfig(config);
  assert.equal(wf.mode, "standard");
  assert.ok(wf.prepared, "should have prepared sub-object");
});

// 13. workflow.mode = "prepared" → kept as "prepared"
test("workflow.mode = prepared → prepared (no change)", () => {
  const result = normalizeWorkflowConfig({ mode: "prepared" });
  assert.equal(result.mode, "prepared");
});

// 14. workflow.mode = "standard" → kept as "standard"
test("workflow.mode = standard → standard (no change)", () => {
  const result = normalizeWorkflowConfig({ mode: "standard" });
  assert.equal(result.mode, "standard");
});

// 15. Default values are correct
test("makeDefaultWorkflowConfig returns canonical defaults", () => {
  const def = makeDefaultWorkflowConfig();
  assert.equal(def.mode, "standard");
  assert.equal(def.prepared.backup, true);
  assert.equal(def.prepared.requireCleanGit, false);
  assert.equal(def.prepared.clearMissingDefault, false);
  assert.equal(def.prepared.maxUpdateBytes, 2 * 1024 * 1024);
  assert.equal(def.prepared.maxBundleBytes, 250 * 1024 * 1024);
  assert.equal("aggressive" in def, false);
});

// 16. workflow.prepared canonical fields pass through unchanged
test("workflow.prepared canonical fields pass through", () => {
  const result = normalizeWorkflowConfig({
    mode: "prepared",
    prepared: {
      backup: false,
      requireCleanGit: false,
      clearMissingDefault: true,
      maxUpdateBytes: 1 * 1024 * 1024,
      maxBundleBytes: 100 * 1024 * 1024
    }
  });
  assert.equal(result.mode, "prepared");
  assert.equal(result.prepared.backup, false);
  assert.equal(result.prepared.requireCleanGit, false);
  assert.equal(result.prepared.clearMissingDefault, true);
  assert.equal(result.prepared.maxUpdateBytes, 1 * 1024 * 1024);
  assert.equal(result.prepared.maxBundleBytes, 100 * 1024 * 1024);
});

test("configEditor clear removes a workspace whose path no longer exists", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "relai-cfg-"));
  const tmpConfig = path.join(tmpDir, "config.json");
  const prev = process.env.REL_AI_MCP_CONFIG;
  process.env.REL_AI_MCP_CONFIG = tmpConfig;
  try {
    fs.writeFileSync(tmpConfig, JSON.stringify({ trustedLocalAgent: true, workspaces: { broken: { path: path.join(tmpDir, "does-not-exist") } } }));
    const { updateWorkspace } = require(path.join(__dirname, "..", "src", "configEditor.js"));
    const current = JSON.parse(fs.readFileSync(tmpConfig, "utf8"));
    const result = updateWorkspace(current, { action: "clear", alias: "broken", confirmClear: true });
    assert.equal(result.ok, true);
    const after = JSON.parse(fs.readFileSync(tmpConfig, "utf8"));
    assert.equal(after.workspaces.broken, undefined);
  } finally {
    if (prev == null) delete process.env.REL_AI_MCP_CONFIG; else process.env.REL_AI_MCP_CONFIG = prev;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("release notes are read from CHANGELOG, not a hardcoded version", () => {
  const { getReleaseNotes } = require(path.join(__dirname, "..", "src", "releaseNotes.js"));
  const notes = getReleaseNotes();
  assert.ok(notes.version && notes.version.length > 0, "release notes should carry a version");
  assert.notEqual(notes.version, "0.13.0", "release notes must not be the old hardcoded 0.13.0");
  assert.ok(Array.isArray(notes.bullets), "release notes should have bullets array");
});

test("staleCommandKeys flags missing keys by KEY, not by command string", () => {
  const { staleCommandKeys } = require(path.join(__dirname, "..", "src", "commandDiscovery.js"));
  const configured = { test: "npm run gone", build: "npm run build" };
  const discovered = { build: "npm run build", lint: "npm run lint" };
  const stale = staleCommandKeys(configured, discovered);
  assert.deepEqual(stale, ["test"], "only the key whose command is no longer discovered is stale");
  // A configured key that IS a discovered key must never be stale (the !discovered[cmd] bug
  // indexed by the command string and misclassified).
  assert.deepEqual(staleCommandKeys({ build: "anything" }, { build: "x" }), []);
});

console.log(`\nWorkflow config normalization tests passed. (${passed} tests)`);
