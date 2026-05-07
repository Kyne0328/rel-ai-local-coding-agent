(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
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
    if (parsed.origin === location.origin && !parsed.searchParams.has("token")) parsed.searchParams.set("token", value);
    return parsed.pathname + parsed.search + parsed.hash;
  }

  async function requestJson(url, options = {}) {
    const value = token();
    const headers = {
      ...(options.headers || {}),
      ...(value ? { Authorization: `Bearer ${value}` } : {})
    };
    if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
    const response = await fetch(urlWithToken(url), { ...options, headers });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      payload = { ok: false, error: text || `HTTP ${response.status}` };
    }
    if (!response.ok) payload.ok = false;
    return payload;
  }

  function ensureSettingsSection() {
    if ($("settings")) return;
    const main = document.querySelector("main.main");
    if (!main) return;
    const diagnostics = $("diagnostics");
    const section = document.createElement("section");
    section.className = "card";
    section.id = "settings";
    section.innerHTML = `
      <div class="card-head">
        <h3>Settings</h3>
        <span class="status-pill" id="settingsStatus">loading</span>
      </div>
      <div class="card-body">
        <div class="settings-tabs">
          <button class="secondary" type="button" data-settings-tab="general">General</button>
          <button class="secondary" type="button" data-settings-tab="safety">Safety</button>
          <button class="secondary" type="button" data-settings-tab="workspaces">Workspaces</button>
          <button class="secondary" type="button" data-settings-tab="advanced">Advanced</button>
        </div>
        <div id="settingsMessage" class="empty">Loading settings...</div>
        <div id="settingsContent"></div>
      </div>`;
    if (diagnostics) main.insertBefore(section, diagnostics);
    else main.appendChild(section);

    const nav = document.querySelector(".nav");
    if (nav && !nav.querySelector('a[href="#settings"]')) {
      const link = document.createElement("a");
      link.href = "#settings";
      link.textContent = "Settings";
      nav.appendChild(link);
    }
    const mobileNav = document.querySelector(".mobile-nav");
    if (mobileNav && !mobileNav.querySelector('a[href="#settings"]')) {
      const link = document.createElement("a");
      link.href = "#settings";
      link.textContent = "Settings";
      mobileNav.appendChild(link);
    }
    injectSettingsStyles();
  }

  function injectSettingsStyles() {
    if ($("settingsStyles")) return;
    const style = document.createElement("style");
    style.id = "settingsStyles";
    style.textContent = `
      .settings-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      .settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .settings-panel{border:1px solid rgba(154,173,212,.12);border-radius:14px;background:rgba(255,255,255,.025);padding:12px}
      .settings-panel h4{margin:0 0 10px;font-size:13px}
      .settings-field{display:grid;gap:6px;margin-bottom:10px}
      .settings-field label{font-size:12px;color:var(--muted);font-weight:700}
      .settings-field input,.settings-field select,.settings-field textarea{width:100%;min-height:38px;border:1px solid var(--line);border-radius:10px;background:#090f1b;color:var(--text);padding:8px 10px;resize:vertical}
      .settings-check{display:flex;align-items:center;gap:9px;margin:8px 0;color:#dfe8f6;font-size:13px}
      .settings-check input{width:auto;min-height:auto}
      .settings-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .settings-warning{border:1px solid rgba(255,194,75,.28);background:rgba(255,194,75,.08);border-radius:12px;padding:10px;color:#ffe2a1;font-size:12px;margin-bottom:12px}
      .settings-danger{border:1px solid rgba(255,102,128,.3);background:rgba(255,102,128,.08);border-radius:12px;padding:10px;color:#ffc6d0;font-size:12px;margin-top:10px}
      @media(max-width:860px){.settings-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function setStatus(text, state = "ok") {
    const status = $("settingsStatus");
    if (!status) return;
    status.className = `status-pill ${state}`;
    status.textContent = text;
  }

  function showMessage(message, state = "") {
    const node = $("settingsMessage");
    if (!node) return;
    node.className = state ? `empty ${state}` : "empty";
    node.textContent = message;
  }

  function field(id, label, value, type = "text") {
    return `<div class="settings-field"><label for="${escapeHtml(id)}">${escapeHtml(label)}</label><input id="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(value == null ? "" : value)}"></div>`;
  }

  function selectField(id, label, value, options) {
    return `<div class="settings-field"><label for="${escapeHtml(id)}">${escapeHtml(label)}</label><select id="${escapeHtml(id)}">${options.map((option) => `<option value="${escapeHtml(option)}" ${String(value) === String(option) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></div>`;
  }

  function checkbox(id, label, value) {
    return `<label class="settings-check"><input id="${escapeHtml(id)}" type="checkbox" ${value ? "checked" : ""}> ${escapeHtml(label)}</label>`;
  }

  function textArea(id, label, value, rows = 4) {
    return `<div class="settings-field"><label for="${escapeHtml(id)}">${escapeHtml(label)}</label><textarea id="${escapeHtml(id)}" rows="${rows}">${escapeHtml(value || "")}</textarea></div>`;
  }

  function readBool(id) {
    return Boolean($(id) && $(id).checked);
  }

  function readValue(id) {
    return $(id) ? $(id).value : "";
  }

  function commandMapToText(map) {
    return Object.entries(map || {}).map(([key, command]) => `${key}=${command}`).join("\n");
  }

  function workspaceByAlias(config, alias) {
    return (config.workspaces || []).find((workspace) => workspace.alias === alias) || null;
  }

  function renderSettings(payload, tab = "general") {
    ensureSettingsSection();
    const cfg = payload.config || {};
    const content = $("settingsContent");
    if (!content) return;
    setStatus(cfg.permissionProfile === "admin" ? "editable" : "read-only", cfg.permissionProfile === "admin" ? "ok" : "warn");
    const adminWarning = cfg.permissionProfile === "admin"
      ? ""
      : `<div class="settings-warning">Configuration writes require admin profile. You can view settings here, but saving will be blocked until the server runs with permissionProfile=admin.</div>`;

    if (tab === "general") {
      content.innerHTML = `${adminWarning}<div class="settings-grid">
        <div class="settings-panel"><h4>Server behavior</h4>
          ${selectField("set_permissionProfile", "Permission profile", cfg.permissionProfile || "pr", ["read-only", "pr", "test", "admin"])}
          ${selectField("set_defaultTaskMode", "Default task mode", cfg.defaultTaskMode || "implement_and_test", ["plan_only", "implement", "implement_and_test", "review_only"])}
          ${selectField("set_sandboxMode", "Sandbox mode", cfg.sandboxMode || "none", ["none", "docker", "docker_readonly_base"])}
          ${checkbox("set_sessionLocksEnabled", "Enable session locks", cfg.sessionLocksEnabled)}
          ${checkbox("set_dashboardEnabled", "Enable dashboard", cfg.dashboardEnabled)}
        </div>
        <div class="settings-panel"><h4>Limits</h4>
          ${field("set_maxReadFileBytes", "Max read bytes", cfg.maxReadFileBytes, "number")}
          ${field("set_maxWriteFileBytes", "Max write bytes", cfg.maxWriteFileBytes, "number")}
          ${field("set_maxTreeEntries", "Max tree entries", cfg.maxTreeEntries, "number")}
          ${field("set_commandTimeoutMs", "Command timeout ms", cfg.commandTimeoutMs, "number")}
          ${field("set_maxConcurrentSessionsPerWorkspace", "Max concurrent sessions/workspace", cfg.maxConcurrentSessionsPerWorkspace, "number")}
        </div>
      </div><div class="settings-actions"><button type="button" onclick="saveGeneralSettings()">Save general settings</button><button class="secondary" type="button" onclick="loadSettingsPanel('general')">Reload</button></div>`;
      return;
    }

    if (tab === "safety") {
      content.innerHTML = `${adminWarning}<div class="settings-warning">High-risk switches require the confirm dangerous checkbox. Prefer workspace command keys over arbitrary commands.</div><div class="settings-grid">
        <div class="settings-panel"><h4>Capabilities</h4>
          ${checkbox("set_allowGitHubCli", "Allow GitHub CLI", cfg.allowGitHubCli)}
          ${checkbox("set_allowDocker", "Allow Docker", cfg.allowDocker)}
          ${checkbox("set_allowArbitraryCommands", "Allow arbitrary commands", cfg.allowArbitraryCommands)}
          ${checkbox("set_allowDestructiveTools", "Allow destructive tools", cfg.allowDestructiveTools)}
          ${checkbox("set_confirmDangerous", "I understand these are high-risk settings", false)}
        </div>
        <div class="settings-panel"><h4>Approval gates</h4>
          ${Object.entries(cfg.approvalGates || {}).map(([key, value]) => checkbox(`gate_${key}`, `Require/enable ${key} gate`, value)).join("")}
        </div>
      </div><div class="settings-actions"><button type="button" onclick="saveSafetySettings()">Save safety settings</button><button class="secondary" type="button" onclick="loadSettingsPanel('safety')">Reload</button></div>`;
      return;
    }

    if (tab === "workspaces") {
      const workspaces = cfg.workspaces || [];
      const alias = readValue("workspaceEditorAlias") || (workspaces[0] && workspaces[0].alias) || "";
      const current = workspaceByAlias(cfg, alias) || {};
      content.innerHTML = `${adminWarning}<div class="settings-grid">
        <div class="settings-panel"><h4>Choose workspace</h4>
          <div class="settings-field"><label for="workspaceEditorAlias">Workspace alias</label><select id="workspaceEditorAlias" onchange="renderWorkspaceEditor()">${workspaces.map((workspace) => `<option value="${escapeHtml(workspace.alias)}" ${workspace.alias === alias ? "selected" : ""}>${escapeHtml(workspace.alias)}</option>`).join("")}<option value="__new__">New workspace...</option></select></div>
          ${field("ws_alias", "Alias", alias === "__new__" ? "" : alias)}
          ${field("ws_path", "Absolute path", current.path || "")}
          ${field("ws_defaultBaseBranch", "Default base branch", current.defaultBaseBranch || "main")}
          ${field("ws_repoSlug", "Repo slug", current.repoSlug || "")}
          ${textArea("ws_protectedBranches", "Protected branches, comma or newline separated", (current.protectedBranches || ["main", "master"]).join("\n"), 3)}
          ${textArea("ws_allowedRemotes", "Allowed remotes", (current.allowedRemotes || ["origin"]).join("\n"), 3)}
        </div>
        <div class="settings-panel"><h4>Commands and workspace capabilities</h4>
          ${textArea("ws_testCommands", "Test commands, one key=command per line", commandMapToText(current.testCommands || {}), 6)}
          ${textArea("ws_commands", "Dev commands, one key=command per line", commandMapToText(current.commands || {}), 6)}
          ${checkbox("ws_allowDocker", "Allow Docker for this workspace", current.allowDocker)}
          ${checkbox("ws_allowArbitraryCommands", "Allow arbitrary commands for this workspace", current.allowArbitraryCommands)}
          ${checkbox("ws_allowDestructiveTools", "Allow destructive tools for this workspace", current.allowDestructiveTools)}
          ${checkbox("ws_confirmDangerous", "I understand workspace high-risk switches", false)}
        </div>
      </div><div class="settings-actions"><button type="button" onclick="saveWorkspaceSettings()">Save workspace</button><button class="danger" type="button" onclick="deleteWorkspaceSettings()">Delete workspace</button><button class="secondary" type="button" onclick="loadSettingsPanel('workspaces')">Reload</button></div>`;
      return;
    }

    content.innerHTML = `${adminWarning}<div class="settings-grid">
      <div class="settings-panel"><h4>Multi-agent</h4>
        ${checkbox("set_multiAgent_enabled", "Enabled", cfg.multiAgent && cfg.multiAgent.enabled)}
        ${field("set_multiAgent_maxSubtasks", "Max subtasks", cfg.multiAgent && cfg.multiAgent.maxSubtasks, "number")}
        ${field("set_multiAgent_maxParallelSubtasks", "Max parallel subtasks", cfg.multiAgent && cfg.multiAgent.maxParallelSubtasks, "number")}
        ${checkbox("set_multiAgent_requireReviewBeforeMerge", "Require review before merge", cfg.multiAgent && cfg.multiAgent.requireReviewBeforeMerge)}
        ${textArea("set_multiAgent_defaultRoles", "Default roles", ((cfg.multiAgent && cfg.multiAgent.defaultRoles) || []).join("\n"), 4)}
      </div>
      <div class="settings-panel"><h4>Product UX and release</h4>
        ${field("set_productUx_dashboardRefreshSeconds", "Dashboard refresh seconds", cfg.productUx && cfg.productUx.dashboardRefreshSeconds, "number")}
        ${field("set_productUx_liveLogPollSeconds", "Live log poll seconds", cfg.productUx && cfg.productUx.liveLogPollSeconds, "number")}
        ${field("set_productUx_staleHours", "Stale hours", cfg.productUx && cfg.productUx.staleHours, "number")}
        ${field("set_release_minimumReadinessScore", "Minimum readiness score", cfg.release && cfg.release.minimumReadinessScore, "number")}
        ${checkbox("set_release_requireHttpToken", "Require HTTP token", cfg.release && cfg.release.requireHttpToken)}
      </div>
    </div><div class="settings-actions"><button type="button" onclick="saveAdvancedSettings()">Save advanced settings</button><button class="secondary" type="button" onclick="loadSettingsPanel('advanced')">Reload</button></div>`;
  }

  async function loadSettings(tab = "general") {
    ensureSettingsSection();
    try {
      showMessage("Loading settings...");
      const payload = await requestJson("/api/settings");
      if (!payload.ok) throw new Error(payload.error || "Could not load settings.");
      window.__relaiSettingsPayload = payload;
      window.__relaiSettingsTab = tab;
      showMessage(`Loaded ${payload.configPath || "config"}.`);
      renderSettings(payload, tab);
    } catch (error) {
      setStatus("error", "bad");
      showMessage(String(error.message || error));
    }
  }

  async function postSettings(body) {
    const payload = await requestJson("/api/settings", { method: "POST", body: JSON.stringify(body) });
    if (!payload.ok) throw new Error(payload.error || "Settings update failed.");
    showMessage(payload.message || "Settings saved.");
    await loadSettings(window.__relaiSettingsTab || "general");
    if (typeof window.refresh === "function") await window.refresh();
  }

  async function postWorkspace(body) {
    const payload = await requestJson("/api/workspaces", { method: "POST", body: JSON.stringify(body) });
    if (!payload.ok) throw new Error(payload.error || "Workspace update failed.");
    showMessage(payload.message || "Workspace saved.");
    await loadSettings("workspaces");
    if (typeof window.refresh === "function") await window.refresh();
  }

  window.loadSettingsPanel = (tab) => loadSettings(tab || "general");
  window.renderWorkspaceEditor = () => renderSettings(window.__relaiSettingsPayload || { config: {} }, "workspaces");
  window.saveGeneralSettings = async () => {
    try {
      await postSettings({
        permissionProfile: readValue("set_permissionProfile"),
        defaultTaskMode: readValue("set_defaultTaskMode"),
        sandboxMode: readValue("set_sandboxMode"),
        sessionLocksEnabled: Boolean($("set_sessionLocksEnabled") && $("set_sessionLocksEnabled").checked),
        dashboardEnabled: Boolean($("set_dashboardEnabled") && $("set_dashboardEnabled").checked),
        maxReadFileBytes: readValue("set_maxReadFileBytes"),
        maxWriteFileBytes: readValue("set_maxWriteFileBytes"),
        maxTreeEntries: readValue("set_maxTreeEntries"),
        commandTimeoutMs: readValue("set_commandTimeoutMs"),
        maxConcurrentSessionsPerWorkspace: readValue("set_maxConcurrentSessionsPerWorkspace")
      });
    } catch (error) { showMessage(String(error.message || error)); setStatus("error", "bad"); }
  };
  window.saveSafetySettings = async () => {
    try {
      const gates = {};
      for (const node of Array.from(document.querySelectorAll('[id^="gate_"]'))) gates[node.id.slice(5)] = node.checked;
      await postSettings({
        confirmDangerous: Boolean($("set_confirmDangerous") && $("set_confirmDangerous").checked),
        allowGitHubCli: Boolean($("set_allowGitHubCli") && $("set_allowGitHubCli").checked),
        allowDocker: Boolean($("set_allowDocker") && $("set_allowDocker").checked),
        allowArbitraryCommands: Boolean($("set_allowArbitraryCommands") && $("set_allowArbitraryCommands").checked),
        allowDestructiveTools: Boolean($("set_allowDestructiveTools") && $("set_allowDestructiveTools").checked),
        approvalGates: gates
      });
    } catch (error) { showMessage(String(error.message || error)); setStatus("error", "bad"); }
  };
  window.saveAdvancedSettings = async () => {
    try {
      await postSettings({
        multiAgent: {
          enabled: Boolean($("set_multiAgent_enabled") && $("set_multiAgent_enabled").checked),
          maxSubtasks: readValue("set_multiAgent_maxSubtasks"),
          maxParallelSubtasks: readValue("set_multiAgent_maxParallelSubtasks"),
          requireReviewBeforeMerge: Boolean($("set_multiAgent_requireReviewBeforeMerge") && $("set_multiAgent_requireReviewBeforeMerge").checked),
          defaultRoles: readValue("set_multiAgent_defaultRoles")
        },
        productUx: {
          dashboardRefreshSeconds: readValue("set_productUx_dashboardRefreshSeconds"),
          liveLogPollSeconds: readValue("set_productUx_liveLogPollSeconds"),
          staleHours: readValue("set_productUx_staleHours")
        },
        release: {
          minimumReadinessScore: readValue("set_release_minimumReadinessScore"),
          requireHttpToken: Boolean($("set_release_requireHttpToken") && $("set_release_requireHttpToken").checked)
        }
      });
    } catch (error) { showMessage(String(error.message || error)); setStatus("error", "bad"); }
  };
  window.saveWorkspaceSettings = async () => {
    try {
      await postWorkspace({
        action: "upsert",
        alias: readValue("ws_alias"),
        path: readValue("ws_path"),
        defaultBaseBranch: readValue("ws_defaultBaseBranch"),
        repoSlug: readValue("ws_repoSlug"),
        protectedBranches: readValue("ws_protectedBranches"),
        allowedRemotes: readValue("ws_allowedRemotes"),
        testCommands: readValue("ws_testCommands"),
        commands: readValue("ws_commands"),
        allowDocker: Boolean($("ws_allowDocker") && $("ws_allowDocker").checked),
        allowArbitraryCommands: Boolean($("ws_allowArbitraryCommands") && $("ws_allowArbitraryCommands").checked),
        allowDestructiveTools: Boolean($("ws_allowDestructiveTools") && $("ws_allowDestructiveTools").checked),
        confirmDangerous: Boolean($("ws_confirmDangerous") && $("ws_confirmDangerous").checked)
      });
    } catch (error) { showMessage(String(error.message || error)); setStatus("error", "bad"); }
  };
  window.deleteWorkspaceSettings = async () => {
    try {
      const alias = readValue("ws_alias");
      if (!alias) throw new Error("Workspace alias is required.");
      if (!confirm(`Delete workspace '${alias}' from Rel.AI config? Files are not deleted.`)) return;
      await postWorkspace({ action: "delete", alias, confirmDelete: true });
    } catch (error) { showMessage(String(error.message || error)); setStatus("error", "bad"); }
  };

  function installTabHandlers() {
    document.addEventListener("click", (event) => {
      const button = event.target && event.target.closest ? event.target.closest("[data-settings-tab]") : null;
      if (!button) return;
      loadSettings(button.getAttribute("data-settings-tab") || "general");
    });
  }

  function bootSettings() {
    ensureSettingsSection();
    installTabHandlers();
    loadSettings("general");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootSettings);
  else bootSettings();
})();
