// Agents section — Phase 1 rendering handled by home.js; Phase 2 adds live subtask binding
export function boot(_data) { /* no-op */ }

export function mountAgents(container, _data) {
  container.innerHTML = '<div class="section"><div class="section-head"><h2>Agents</h2></div><div class="agent-grid" id="agentGrid"></div></div>';
}
