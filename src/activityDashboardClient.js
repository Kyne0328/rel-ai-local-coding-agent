(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
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
  async function fetchJson(url) {
    const value = token();
    const response = await fetch(urlWithToken(url), { headers: value ? { Authorization: `Bearer ${value}` } : {} });
    const text = await response.text();
    try { return JSON.parse(text); } catch (_error) { return { ok: false, error: text || `HTTP ${response.status}` }; }
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
  function pill(value) {
    const text = String(value || "").toLowerCase();
    const cls = text.includes("fail") || text.includes("error") ? "bad" : text.includes("warn") || text.includes("pending") ? "warn" : "ok";
    return `<span class="status-pill ${cls}">${escapeHtml(value || "ok")}</span>`;
  }
  function timeOf(entry) { return entry.ts || entry.at || entry.createdAt || entry.timestamp || ""; }
  function toolName(entry) {
    return String(entry.displayTool || entry.tool || entry.type || entry.event || "activity").replace(/^relai_/, "").replace(/_/g, " ");
  }
  function shortId(value) {
    const text = String(value || "");
    return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
  }
  function details(entry) {
    const parts = [];
    if (entry.error) parts.push(entry.error);
    else if (entry.displayMessage) parts.push(entry.displayMessage);
    else if (entry.message) parts.push(entry.message);
    else if (entry.path) parts.push(entry.path);
    else parts.push(entry.ok === false ? "Failed" : "Completed");
    if (entry.workspace) parts.push(`workspace ${entry.workspace}`);
    if (entry.sessionId) parts.push(`session ${shortId(entry.sessionId)}`);
    if (entry.ms != null) parts.push(`${entry.ms}ms`);
    return parts.filter(Boolean).join(" - ");
  }
  function renderActivity(entries) {
    const activityRows = $("activityRows");
    if (!activityRows) return;
    const sorted = [...(entries || [])].sort((a, b) => (Date.parse(timeOf(b)) || 0) - (Date.parse(timeOf(a)) || 0));
    const activityCount = $("activityCount");
    if (activityCount) activityCount.textContent = `${sorted.length} events`;
    activityRows.innerHTML = sorted.length ? sorted.slice(0, 20).map((entry) => {
      const state = entry.ok === false ? "failed" : "ok";
      const message = details(entry);
      return `<tr><td class="nowrap">${escapeHtml(age(timeOf(entry)))}</td><td class="truncate mono">${escapeHtml(toolName(entry))}</td><td class="truncate">${escapeHtml(entry.workspace || "-")}</td><td>${pill(state)}</td><td class="truncate" title="${escapeHtml(message)}">${escapeHtml(message)}</td></tr>`;
    }).join("") : `<tr><td colspan="5"><div class="empty">No audit events yet.</div></td></tr>`;
  }
  async function refreshActivity() {
    const payload = await fetchJson("/api/logs?limit=200");
    if (payload && payload.entries) renderActivity(payload.entries);
  }
  window.refreshActivity = refreshActivity;
  const originalRefresh = window.refresh;
  if (typeof originalRefresh === "function") {
    window.refresh = async function () {
      const result = await originalRefresh.apply(this, arguments);
      await refreshActivity();
      return result;
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshActivity);
  else refreshActivity();
})();
