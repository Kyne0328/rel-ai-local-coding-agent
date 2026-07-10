const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("../process");
const { clampNumber } = require("./limits");

const SAFE_BROWSER_CHECK_NAME = /^[A-Za-z0-9:._-]+$/;

function readPackageScripts(root) {
  const packageJson = path.join(root, "package.json");
  if (!fs.existsSync(packageJson)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
    return typeof pkg?.scripts === "object" ? pkg.scripts : {};
  } catch {
    return {};
  }
}

function parseBrowserProbe(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  const lastLine = text.split(/\r?\n/).findLast(Boolean);
  if (!lastLine) return null;
  try {
    const probe = JSON.parse(lastLine);
    if (probe && typeof probe === "object") return probe;
  } catch {}
  return null;
}

function resolveBrowserTarget(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text || /^https?:\/\//i.test(text)) return text;
  if (!text.startsWith("/")) return text;
  let host = "127.0.0.1";
  let port = Number(process.env.REL_AI_MCP_PORT || 3333);
  try {
    const connection = require("../connectionProfile");
    const profile = connection.readConnectionProfile();
    host = profile.host || host;
    port = Number(profile.port || port || 3333);
  } catch {}
  return new URL(text, `http://${host}:${port || 3333}`).toString();
}

async function relaiBrowser(workspace, config, args = {}) {
  const requestedUrl = String(args.url || args.route || "").trim();
  const command = String(args.command || "").trim();
  if (command) {
    // Bounded: only named package.json scripts may run, invoked as `npm run <name>`.
    // No arbitrary shell — keeps this a validation bridge, not a command runner.
    const scripts = readPackageScripts(workspace.path);
    const available = Object.keys(scripts).sort((a, b) => a.localeCompare(b));
    if (!SAFE_BROWSER_CHECK_NAME.test(command) || !Object.hasOwn(scripts, command)) {
      return {
        ok: false,
        workspace: workspace.alias,
        mode: "check",
        check: command,
        error: `Unknown check '${command}'. relai_browser runs named package.json scripts only. Available: ${available.join(", ") || "(none)"}.`,
        availableChecks: available
      };
    }
    // command passed SAFE_BROWSER_CHECK_NAME above (no spaces/metacharacters), so it
    // is safe to run through a shell. shell:true is required on Windows, where Node
    // refuses to spawn npm.cmd directly (EINVAL) since 18.20/20.12.
    const npmCommand = `npm run ${command}`;
    const result = await runProcess(npmCommand, [], {
      cwd: workspace.path,
      shell: true,
      commandString: npmCommand,
      timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000)
    }, config);
    return { ok: result.exitCode === 0, workspace: workspace.alias, mode: "check", check: command, ...summarizeCommand(result) };
  }
  if (!requestedUrl) throw new Error("url, route, or check is required.");
  const url = resolveBrowserTarget(requestedUrl);
  const script = String.raw`
    const target = ${JSON.stringify(url)};
    fetch(target).then(async (res) => {
      const text = await res.text();
      console.log(JSON.stringify({ ok: res.ok, status: res.status, url: res.url, bytes: text.length, title: ((text.match(/<title[^>]*>([^<]*)<\/title>/i)||[])[1] || '') }));
      process.exit(res.ok ? 0 : 1);
    }).catch((err) => { console.error(err && err.message || String(err)); process.exit(1); });
  `;
  const result = await runProcess(process.execPath, ["-e", script], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 600000, 30000) }, config);
  const probe = parseBrowserProbe(result.stdout);
  return {
    workspace: workspace.alias,
    mode: "http",
    url,
    ...(requestedUrl !== url ? { requestedUrl } : {}),
    ...(probe ? {
      reachable: true,
      httpStatus: typeof probe.status === "number" ? probe.status : null,
      finalUrl: probe.url || url,
      responseBytes: typeof probe.bytes === "number" ? probe.bytes : null,
      title: probe.title || ""
    } : { reachable: false }),
    ...summarizeCommand(result),
    // Require an actual successful probe — never report ok:true for an
    // unreachable host (no probe) or a non-2xx response (probe.ok === false).
    ok: result.exitCode === 0 && !!probe && probe.ok !== false
  };
}

module.exports = { relaiBrowser };
