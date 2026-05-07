(function () {
  "use strict";

  const AGENT_ROLES = ["Planner", "Implementer", "Tester", "Reviewer", "CI Repair", "Docs", "Security"];

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value == null ? "" : String(value);
  }

  function setHtml(id, value) {
    const node = $(id);
    if (node) node.innerHTML = value == null ? "" : String(value);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function token() {
    const input = $("token");
    const value = input ? input.value.trim() : "";
    if (value) {
      try { sessionStorage.setItem("relai_dashboard_token", value); } catch (_error) {}
    }
    return value;
  }

  function urlWithToken(url) {
    const value = token();
    if (!value) return url;
    const parsed = new URL(url, location.origin);
    if (parsed.origin === location.origin && !parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", value);
    }
    return parsed.pathname + parsed.search + parsed.hash;
  }

  async function fetchJson(url) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const value = token();
      const response = await fetch(urlWithToken(url), {
        headers: value ? { Authorization: `Bearer ${value}` } : {},
        signal: controller ? controller.signal : undefined
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        payload = { ok: false, error: text || `HTTP ${response.status}` };
      }
      if (!response.ok && payload.ok !== true) payload.ok = false;
      if (response.status === 401) {
        payload.error = payload.error || "Unauthorized. Paste the dashboard token or open /dashboard?token=<token>.";
      }
      return payload;
    } catch (error) {
      return {
        ok: false,
        error: error && error.name === "AbortError" ? "Dashboard request timed out." : String(error)
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function statusClass(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("fail") || text.includes("error") || text.includes("blocked") || text.includes("denied")) return "bad";
    if (text.includes("warn") || text.includes("pending") || text.includes("admin") || text.includes("run") || text.includes("active")) return "warn";
    return "ok";
  }

  function pill(value) {
    return `<span class="status-pill ${statusClass(value)}">${escapeHtml(value || "ok")}</span>`;
  }

  function metric(label, value, meta, type) {
    return `<div class="metric ${type || ""}"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div><div class="metric-meta">${escapeHtml(meta || "")}</div></div>`;
  }

  function empty(message) {
    return `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function item(title, subtitle, time, state) {
    const cls = statusClass(state);
    return `<div class="list-item"><span class="dot ${cls === "ok" ? "" : cls}"></span><div><div class="item-title">${escapeHtml(title)}</div><div class="item-sub">${escapeHtml(subtitle || "")}</div></div><div class="item-time">${escapeHtml(time || "")}</div></div>`;
  }

  function age(value) {
    const stamp = Date.parse(value || "");
    if (!Number.isFinite(stamp)) return value || "";
    const minutes = Math.floor(Math.max(0, Date.now() - stamp) / 60000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function readInitialPayload() {
    try {
      const node = $("initialDashboardData");
      return node && node.textContent ? JSON.parse(node.textContent) : null;
    } catch (error) {
      return { ok: false, error: `Embedded dashboard payload could not be parsed: ${String(error)}` };
    }
  }

  function renderDashboard(data) {
    const payload = data || { ok: false, error: "No dashboard data returned." };
    const cfg = payload.config || {};
    const counts = payload.counts || {};
    const health = payload.health || {};
    const readiness = payload.readiness || {};
    const workspaces = Array.isArray(cfg.workspaces) ? cfg.workspaces : [];
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    const approvals = Array.isArray(payload.approvals) ? payload.approvals : [];
    const locks = Array.isArray(payload.locks) ? payload.locks : [];
    const findings = Array.isArray(health.findings) ? health.findings : [];
    const audit = payload.auditTail && Array.isArray(payload.auditTail.entries) ? payload.auditTail.entries : [];
    const healthWorkspaces = Array.isArray(health.workspaces) ? health.workspaces : [];

    const status = $("serverStatus");
    if (status) {
      status.className = `status-pill ${payload.ok ? "ok" : "bad"}`;
      status.textContent = payload.ok ? "Online" : "Error";
    }

    setText("subtitle", payload.ok ? `Rel.AI MCP - ${cfg.permissionProfile || "unknown"} profile` : (payload.error || "Dashboard data failed to load"));
    setText("lastUpdated", `Updated ${new Date().toLocaleTimeString()}`);

    setHtml("metrics", [
      metric("Workspaces", workspaces.length, "configured", "blue"),
      metric("Sessions", counts.sessions || sessions.length, "task sessions", "blue"),
      metric("Jobs", counts.jobs || jobs.length, "background jobs", "warn"),
      metric("Approvals", counts.approvals || approvals.length, "approval gates", "purple"),
      metric("Health", findings.length, health.ok === false ? "needs attention" : "all clear", health.ok === false ? "bad" : "good"),
      metric("Readiness", readiness.score != null ? readiness.score : "N/A", readiness.rating || "release check", readiness.ok === false ? "warn" : "good")
    ].join(""));

    setText("workspaceCount", `${workspaces.length} configured`);
    const workspaceInput = $("workspace");
    if (workspaceInput && !workspaceInput.value && workspaces[0]) workspaceInput.value = workspaces[0].alias || "";
    setHtml("workspacesList", workspaces.length ? workspaces.map((workspace) => {
      const currentHealth = healthWorkspaces.find((item) => item.alias === workspace.alias) || {};
      return `<div class="workspace-card"><strong>${escapeHtml(workspace.alias || "workspace")}</strong><div class="path">${escapeHtml(workspace.path || "")}</div><div class="badge-row"><span class="badge ${currentHealth.ok === false ? "warn" : "good"}">${currentHealth.ok === false ? "check" : "healthy"}</span><span class="badge">base ${escapeHtml(workspace.defaultBaseBranch || "main")}</span><span class="badge">tests ${escapeHtml((workspace.testCommandKeys || []).length)}</span><span class="badge">worktrees ${escapeHtml(currentHealth.worktreeCount == null ? 0 : currentHealth.worktreeCount)}</span></div></div>`;
    }).join("") : empty("No workspaces configured."));

    const profilePill = $("profilePill");
    if (profilePill) {
      profilePill.className = `status-pill ${statusClass(cfg.permissionProfile)}`;
      profilePill.textContent = `${cfg.permissionProfile || "unknown"} profile`;
    }
    setHtml("configList", [
      ["State directory", cfg.stateDir || "not reported", "ok"],
      ["Permission profile", cfg.permissionProfile || "unknown", cfg.permissionProfile],
      ["Dashboard", cfg.dashboardEnabled === false ? "disabled" : "enabled", cfg.dashboardEnabled === false ? "bad" : "ok"],
      ["Arbitrary commands", cfg.allowArbitraryCommands ? "enabled" : "disabled", cfg.allowArbitraryCommands ? "warn" : "ok"],
      ["Docker", cfg.allowDocker ? "enabled" : "disabled", cfg.allowDocker ? "warn" : "ok"],
      ["GitHub CLI", cfg.allowGitHubCli ? "enabled" : "disabled", cfg.allowGitHubCli ? "warn" : "ok"]
    ].map((entry) => item(entry[0], entry[1], "", entry[2])).join(""));

    setText("activityCount", `${audit.length} events`);
    setHtml("activityRows", audit.length ? audit.slice(0, 15).map((entry) => {
      const state = entry.ok === false ? "failed" : "ok";
      return `<tr><td class="nowrap">${escapeHtml(age(entry.ts || entry.createdAt))}</td><td class="truncate mono">${escapeHtml(entry.tool || entry.type || "activity")}</td><td class="truncate">${escapeHtml(entry.workspace || "-")}</td><td>${pill(state)}</td><td class="truncate">${escapeHtml(entry.error || entry.message || entry.path || "")}</td></tr>`;
    }).join("") : `<tr><td colspan="5">${empty("No audit events yet. Use Rel.AI tools and this table will populate.")}</td></tr>`);

    setText("sessionCount", sessions.length);
    setText("jobCount", jobs.length);
    setText("approvalCount", approvals.length);
    setText("findingCount", findings.length);
    setHtml("sessionsList", sessions.length ? sessions.slice(0, 8).map((session) => item(session.id || "session", `${session.workspace || "workspace"} - ${session.status || "unknown"}`, age(session.updatedAt || session.createdAt), session.status)).join("") : empty("No task sessions yet."));
    setHtml("jobsList", jobs.length ? jobs.slice(0, 8).map((job) => item(job.id || "job", `${job.workspace || "workspace"} - ${job.commandKey || job.command || "command"}`, age(job.updatedAt || job.createdAt), job.status)).join("") : empty("No background jobs."));
    setHtml("approvalsList", approvals.length ? approvals.slice(0, 8).map((approval) => item(approval.id || "approval", `${approval.action || "approval"} - ${approval.status || "pending"}`, age(approval.updatedAt || approval.createdAt), approval.status)).join("") : empty("No pending approvals."));
    setHtml("healthList", findings.length ? findings.slice(0, 8).map((finding) => item(finding.code || finding.severity || "finding", finding.message || "", "", finding.severity || "warn")).join("") : empty("No health findings."));

    setText("agentCount", `${AGENT_ROLES.length} roles`);
    setHtml("agentGrid", AGENT_ROLES.map((role) => {
      let state = "Ready";
      if (role === "Tester" && jobs.length) state = "Jobs visible";
      if (role === "Reviewer" && approvals.length) state = "Approvals visible";
      if (role === "Security" && health.ok === false) state = "Needs attention";
      return `<div class="agent"><div class="agent-top"><span class="agent-icon">${escapeHtml(role.charAt(0))}</span>${pill(state)}</div><div class="agent-name">${escapeHtml(role)}</div><div class="agent-state">${escapeHtml(state)}</div></div>`;
    }).join(""));

    setHtml("terminal", `<span class="prompt">$</span> relai dashboard<br>${payload.ok ? '<span class="ok">ok</span> backend data loaded' : `<span class="bad">error</span> ${escapeHtml(payload.error || "load failed")}`}<br><span class="ok">ok</span> ${escapeHtml(workspaces.length)} workspaces, ${escapeHtml(sessions.length)} sessions, ${escapeHtml(jobs.length)} jobs<br>${findings.length ? `<span class="warn">warn</span> ${escapeHtml(findings.length)} health findings` : '<span class="ok">ok</span> no health findings'}`);
    setText("rawOut", JSON.stringify(payload, null, 2));
  }

  async function refresh() {
    const data = await fetchJson("/api/dashboard/v10?limit=100&requireHttpToken=0");
    renderDashboard(data);
    return data;
  }

  async function loadConnection() {
    const profile = await fetchJson("/api/connection");
    const status = $("connectorStatus");
    if (status) {
      status.className = `status-pill ${profile.permanentUrlConfigured ? "ok" : "warn"}`;
      status.textContent = profile.permanentUrlConfigured ? "permanent URL" : "local only";
    }
    setText("connectorBox", [
      `Dashboard: ${profile.dashboardUrl || ""}`,
      `ChatGPT MCP URL: ${profile.chatgptMcpUrl || ""}`,
      "ChatGPT auth: No Authentication",
      `Health: ${profile.chatgptHealthUrl || ""}`,
      "",
      profile.permanentUrlConfigured ? "Stable public URL is configured." : "No stable public URL configured yet."
    ].join("\n"));
  }

  async function showJson(id, url) {
    setText(id, JSON.stringify(await fetchJson(url), null, 2));
  }

  window.refresh = refresh;
  window.loadHealth = () => showJson("maintenanceOut", "/api/health-monitor");
  window.loadReadiness = () => showJson("maintenanceOut", "/api/readiness?requireHttpToken=0");
  window.loadLogs = () => showJson("maintenanceOut", "/api/logs?limit=100");
  window.loadDiff = () => {
    const workspace = $("workspace") ? $("workspace").value.trim() : "";
    const sessionId = $("sessionId") ? $("sessionId").value.trim() : "";
    return showJson("diffOut", `/api/session/diff?workspace=${encodeURIComponent(workspace)}&sessionId=${encodeURIComponent(sessionId)}`);
  };
  window.toggleRaw = () => {
    const panel = $("rawPanel");
    if (panel) panel.classList.toggle("open");
  };
  window.toggleLive = () => {
    refresh();
    const button = $("liveBtn");
    if (button) button.textContent = "Refresh live";
  };

  async function boot() {
    try {
      const urlToken = new URLSearchParams(location.search).get("token") || "";
      const input = $("token");
      if (urlToken && input) input.value = urlToken;
      const initial = readInitialPayload();
      if (initial) renderDashboard(initial);
      await refresh();
      await loadConnection();
    } catch (error) {
      setText("subtitle", `Dashboard script error: ${String(error)}`);
      setText("maintenanceOut", String(error && error.stack ? error.stack : error));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
