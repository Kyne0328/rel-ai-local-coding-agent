const { runProcess, summarizeCommand } = require("../process");
const { clampNumber } = require("./limits");

function parseHttpProbe(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  const lastLine = text.split(/\r?\n/).findLast(Boolean);
  if (!lastLine) return null;
  try {
    const probe = JSON.parse(lastLine);
    return probe && typeof probe === "object" ? probe : null;
  } catch {
    return null;
  }
}

function localConnectionBaseUrl() {
  let host = "127.0.0.1";
  let port = Number(process.env.REL_AI_MCP_PORT || 3333);
  try {
    const { readConnectionProfile } = require("../connectionProfile");
    const profile = readConnectionProfile();
    host = profile.host || host;
    port = Number(profile.port || port || 3333);
  } catch {}
  if (host === "0.0.0.0") host = "127.0.0.1";
  return `http://${host}:${port || 3333}`;
}

function resolveLocalRouteTarget(rawRoute) {
  const route = String(rawRoute || "").trim();
  if (!route) throw new Error("relai_http_probe requires route.");
  if (!route.startsWith("/") || route.startsWith("//")) {
    throw new Error("relai_http_probe route must be a local path beginning with one '/'; absolute and protocol-relative URLs are not accepted.");
  }
  const base = new URL(localConnectionBaseUrl());
  const target = new URL(route, base);
  if (target.origin !== base.origin) {
    throw new Error("relai_http_probe route must resolve to the configured local Rel.AI origin.");
  }
  return target.toString();
}

async function probeHttpTarget(workspace, config, target, args = {}, requested = {}) {
  const script = String.raw`
    const target = ${JSON.stringify(target)};
    fetch(target).then(async (res) => {
      const text = await res.text();
      console.log(JSON.stringify({ ok: res.ok, status: res.status, url: res.url, bytes: Buffer.byteLength(text, 'utf8'), title: ((text.match(/<title[^>]*>([^<]*)<\/title>/i)||[])[1] || '') }));
      process.exit(res.ok ? 0 : 1);
    }).catch((err) => { console.error(err && err.message || String(err)); process.exit(1); });
  `;
  const result = await runProcess(process.execPath, ["-e", script], {
    cwd: workspace.path,
    timeout: clampNumber(args.timeoutMs, 1000, 600000, 30000)
  }, config);
  const probe = parseHttpProbe(result.stdout);
  return {
    workspace: workspace.alias,
    mode: "http-probe",
    url: target,
    ...requested,
    ...(probe ? {
      reachable: true,
      httpStatus: typeof probe.status === "number" ? probe.status : null,
      finalUrl: probe.url || target,
      responseBytes: typeof probe.bytes === "number" ? probe.bytes : null,
      title: probe.title || ""
    } : { reachable: false }),
    ...summarizeCommand(result),
    ok: result.exitCode === 0 && !!probe && probe.ok !== false
  };
}

async function relaiHttpProbe(workspace, config, args = {}) {
  const route = String(args.route || "").trim();
  return probeHttpTarget(workspace, config, resolveLocalRouteTarget(route), args, { route });
}

module.exports = { probeHttpTarget, relaiHttpProbe, resolveLocalRouteTarget };
