const { spawn } = require("node:child_process");
const http = require("node:http");

const HTTPS_URL_RE = /https:\/\/[^\s"'<>]+/i;
const CLOUDFLARE_RE = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/i;
const NGROK_RE = /https:\/\/[-a-z0-9.]+\.ngrok(?:-free)?\.app|https:\/\/[-a-z0-9.]+\.ngrok\.io/i;
const LOCALTUNNEL_RE = /https:\/\/[-a-z0-9.]+\.loca\.lt/i;

function normalizeTunnel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "none" || text === "off" || text === "false" || text === "0") return "none";
  if (text === "public" || text === "auto" || text === "1" || text === "true") return "auto";
  if (["cloudflare", "cloudflared", "ngrok", "localtunnel", "lt", "custom"].includes(text)) return text === "lt" ? "localtunnel" : text === "cloudflared" ? "cloudflare" : text;
  throw new Error(`Unknown tunnel provider: ${value}`);
}

function providerPlans(provider, { port, localUrl, command } = {}) {
  const safePort = Number(port || 3333);
  const url = localUrl || `http://127.0.0.1:${safePort}`;
  if (provider === "custom") {
    if (!command) throw new Error("--tunnel custom requires --tunnel-command <command>.");
    return [shellPlan(command)];
  }
  if (provider === "cloudflare") {
    return [
      {
        provider,
        command: "cloudflared",
        args: ["tunnel", "--url", url],
        urlPattern: CLOUDFLARE_RE,
        help: "Install cloudflared, or use --tunnel ngrok/localtunnel/custom."
      },
      {
        provider,
        command: process.platform === "win32" ? "npx.cmd" : "npx",
        args: ["--yes", "cloudflared", "tunnel", "--url", url],
        urlPattern: CLOUDFLARE_RE,
        help: "Requires npm/npx internet access for the cloudflared package."
      }
    ];
  }
  if (provider === "ngrok") {
    return [
      {
        provider,
        command: "ngrok",
        args: ["http", String(safePort), "--log=stdout"],
        urlPattern: NGROK_RE,
        afterStartProbe: () => readNgrokApiUrl(4040),
        help: "Install ngrok and sign in, or use --tunnel cloudflare/localtunnel/custom."
      },
      {
        provider,
        command: process.platform === "win32" ? "npx.cmd" : "npx",
        args: ["--yes", "ngrok", "http", String(safePort), "--log=stdout"],
        urlPattern: NGROK_RE,
        afterStartProbe: () => readNgrokApiUrl(4040),
        help: "Requires npm/npx internet access for the ngrok package."
      }
    ];
  }
  if (provider === "localtunnel") {
    return [
      {
        provider,
        command: process.platform === "win32" ? "npx.cmd" : "npx",
        args: ["--yes", "localtunnel", "--port", String(safePort)],
        urlPattern: LOCALTUNNEL_RE,
        help: "Requires npm/npx internet access."
      }
    ];
  }
  throw new Error(`Unsupported tunnel provider: ${provider}`);
}

function providerPlan(provider, options = {}) {
  return providerPlans(provider, options)[0];
}

function shellPlan(command) {
  return {
    provider: "custom",
    command: process.platform === "win32" ? "cmd.exe" : "sh",
    args: process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command],
    urlPattern: HTTPS_URL_RE,
    help: "The custom command must print its public https:// URL to stdout/stderr."
  };
}

function readNgrokApiUrl(port = 4040) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/tunnels", timeout: 800 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const tunnel = (data.tunnels || []).find(t => String(t.public_url || "").startsWith("https://"));
          resolve(tunnel ? tunnel.public_url : "");
        } catch (_) {
          resolve("");
        }
      });
    });
    req.on("error", () => resolve(""));
    req.on("timeout", () => { req.destroy(); resolve(""); });
  });
}

function extractPublicUrl(text, pattern) {
  const source = String(text || "");
  const providerMatch = source.match(pattern || HTTPS_URL_RE);
  const genericMatch = providerMatch || source.match(HTTPS_URL_RE);
  return genericMatch ? genericMatch[0].replace(/[).,;]+$/, "") : "";
}

async function startTunnel({ provider = "none", port = 3333, localUrl = "", command = "", timeoutMs = 30000, onLog = () => {} } = {}) {
  const normalized = normalizeTunnel(provider);
  if (normalized === "none") return { ok: false, provider: "none", publicUrl: "", process: null, skipped: true };

  const providers = normalized === "auto" ? ["cloudflare", "ngrok", "localtunnel"] : [normalized];
  const errors = [];
  for (const candidate of providers) {
    try {
      const result = await startOneTunnel(candidate, { port, localUrl, command, timeoutMs, onLog });
      if (result.ok) return result;
      errors.push(`${candidate}: ${result.error || "no public URL detected"}`);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: false, provider: normalized, publicUrl: "", process: null, error: errors.join("; ") };
}

async function startOneTunnel(provider, { port, localUrl, command, timeoutMs, onLog }) {
  const plans = providerPlans(provider, { port, localUrl, command });
  const errors = [];
  for (const plan of plans) {
    const result = await startProcessTunnel(plan, { timeoutMs, onLog });
    if (result.ok) return result;
    errors.push(`${plan.command}: ${result.error || "no public URL detected"}`);
  }
  return { ok: false, provider, publicUrl: "", process: null, error: errors.join("; ") };
}

function startProcessTunnel(plan, { timeoutMs, onLog }) {
  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let settled = false;
    let buffer = "";
    let lastProbe = 0;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.ok && child.exitCode === null && !child.killed) child.kill();
      resolve(result);
    };

    const maybeUrl = async (chunk) => {
      buffer += String(chunk || "");
      onLog(String(chunk || ""), plan.provider);
      const parsed = extractPublicUrl(buffer, plan.urlPattern);
      if (parsed) {
        finish({ ok: true, provider: plan.provider, publicUrl: parsed, process: child, command: [plan.command, ...plan.args].join(" ") });
        return;
      }
      if (plan.afterStartProbe && Date.now() - lastProbe > 1000) {
        lastProbe = Date.now();
        const probed = await plan.afterStartProbe();
        if (probed) finish({ ok: true, provider: plan.provider, publicUrl: probed, process: child, command: [plan.command, ...plan.args].join(" ") });
      }
    };

    const timer = setTimeout(() => {
      finish({ ok: false, provider: plan.provider, publicUrl: "", process: null, error: `Timed out after ${timeoutMs}ms waiting for a public URL. ${plan.help || ""}`.trim() });
    }, Number(timeoutMs || 30000));

    child.on("error", (error) => finish({ ok: false, provider: plan.provider, publicUrl: "", process: null, error: `${error.message}. ${plan.help || ""}`.trim() }));
    child.on("exit", (code, signal) => {
      if (!settled) finish({ ok: false, provider: plan.provider, publicUrl: "", process: null, error: `Tunnel process exited before URL was detected (code=${code}, signal=${signal}). ${plan.help || ""}`.trim() });
    });
    child.stdout.on("data", maybeUrl);
    child.stderr.on("data", maybeUrl);
  });
}

module.exports = {
  normalizeTunnel,
  extractPublicUrl,
  startTunnel,
  providerPlan,
  providerPlans
};
