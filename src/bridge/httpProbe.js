import { readConnectionProfile } from "../connectionProfile.js";
import { clampNumber } from "./limits.js";

function localConnectionBaseUrl() {
  let host = "127.0.0.1";
  let port = Number(process.env.REL_AI_MCP_PORT || 3333);
  try {
    const profile = readConnectionProfile();
    host = profile.host || host;
    port = Number(profile.port || port || 3333);
  } catch {}
  if (host === "0.0.0.0") host = "127.0.0.1";
  return `http://${host}:${port || 3333}`;
}

function resolveLocalRouteTarget(rawRoute) {
  const route = String(rawRoute || "").trim();
  if (!route) throw new Error('relai_validate action "http" requires route.');
  if (!route.startsWith("/") || route.startsWith("//")) {
    throw new Error('relai_validate action "http" route must be a local path beginning with one \'/\'; absolute and protocol-relative URLs are not accepted.');
  }
  const base = new URL(localConnectionBaseUrl());
  const target = new URL(route, base);
  if (target.origin !== base.origin) {
    throw new Error('relai_validate action "http" route must resolve to the configured local Rel.AI origin.');
  }
  return target.toString();
}

async function probeHttpTarget(workspace, _config, target, args = {}, requested = {}) {
  const controller = new AbortController();
  const timeoutMs = clampNumber(args.timeoutMs, 1000, 600000, 30000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { signal: controller.signal });
    const text = await response.text();
    const title = ((text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
    return {
      ok: response.ok,
      workspace: workspace.alias,
      ...requested,
      reachable: true,
      statusCode: response.status,
      finalUrl: response.url || target,
      responseBytes: Buffer.byteLength(text, 'utf8'),
      title
    };
  } catch (error) {
    return {
      ok: false,
      workspace: workspace.alias,
      ...requested,
      reachable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function relaiHttpProbe(workspace, config, args = {}) {
  const route = String(args.route || "").trim();
  return probeHttpTarget(workspace, config, resolveLocalRouteTarget(route), args, { route });
}

export { relaiHttpProbe };
