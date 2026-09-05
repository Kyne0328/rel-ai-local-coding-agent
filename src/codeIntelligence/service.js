import { repositoryIntelligence } from '../repository/intelligence/service.js';
import { disposeLspWorkspace, inspectWithLsp, noteLspMutation, planSemanticRename, providerStatuses, shutdownLspSessions } from './lspManager.js';

const LSP_ACTIONS = new Set(['definition', 'references', 'hover', 'implementation']);

function createCodeIntelligenceService() {
  return Object.freeze({
    dispose: workspace => disposeLspWorkspace(workspace),
    inspect: async (workspace, config = {}, args = {}, options = {}) => {
      const action = String(args.action || '').toLowerCase();
      const nativeAction = ['definition', 'hover', 'implementation'].includes(action) ? 'symbol' : action;
      const nativeNeedsSymbol = ['symbol', 'references', 'trace'].includes(nativeAction);
      const canRunNative = !nativeNeedsSymbol || Boolean(args.symbol);
      let native = null;
      if (canRunNative && ['symbol', 'references', 'related', 'impact', 'trace', 'diagnostics', 'architecture'].includes(nativeAction)) {
        native = await repositoryIntelligence.codeInspect(workspace, config, { ...args, action: nativeAction }, options);
      }

      if (action === 'diagnostics') {
        return {
          ...(native || { ok: true, workspace: workspace.alias, action }),
          languageServers: providerStatuses(workspace),
          intelligence: evidence('relai-native', [], false)
        };
      }
      if (action === 'architecture') {
        return {
          ...native,
          intelligence: evidence('relai-native', [], false)
        };
      }

      const shouldAskLsp = LSP_ACTIONS.has(action) || ['symbol', 'impact', 'trace'].includes(action);
      if (!shouldAskLsp) return native;
      const anchor = resolveAnchor(args, native);
      if (!anchor) return attachFallback(native, null, 'No concrete symbol location was available for language-server resolution.', action);
      const lspAction = action === 'impact' || action === 'trace' ? 'references' : action;
      const lsp = await inspectWithLsp(workspace, { ...args, action: lspAction }, anchor, options);
      if (!lsp.available) return attachFallback(native, lsp, lsp.error || lsp.reason, action);

      if (action === 'definition') {
        return {
          ok: true,
          workspace: workspace.alias,
          action,
          symbol: args.symbol || native?.symbol,
          definitions: lsp.result,
          definitionCount: lsp.result.length,
          nativeDefinitions: native?.definitions || [],
          intelligence: evidence(lsp.provider, native ? ['relai-native'] : [], false, lsp.status)
        };
      }
      if (action === 'hover') {
        return {
          ok: true,
          workspace: workspace.alias,
          action,
          symbol: args.symbol || native?.symbol,
          hover: lsp.result,
          definitions: native?.definitions || [],
          intelligence: evidence(lsp.provider, native ? ['relai-native'] : [], false, lsp.status)
        };
      }
      if (action === 'implementation') {
        return {
          ok: true,
          workspace: workspace.alias,
          action,
          symbol: args.symbol || native?.symbol,
          implementations: lsp.result,
          implementationCount: lsp.result.length,
          intelligence: evidence(lsp.provider, native ? ['relai-native'] : [], false, lsp.status)
        };
      }
      if (action === 'references') return mergeReferences(native, lsp, workspace.alias, args.symbol);
      if (action === 'symbol') {
        return {
          ...native,
          semanticHover: lsp.result,
          intelligence: evidence(lsp.provider, native ? ['relai-native'] : [], false, lsp.status)
        };
      }
      return action === 'trace' ? mergeTrace(native, lsp) : mergeImpact(native, lsp);
    },
    semanticRename: (workspace, semantic, options = {}) => planSemanticRename(workspace, semantic, options),
    status: workspace => providerStatuses(workspace),
    noteMutation: (workspace, paths) => noteLspMutation(workspace, paths),
    shutdown: () => shutdownLspSessions()
  });
}

function resolveAnchor(args, native) {
  if (args.path && args.line != null && args.column != null) {
    return { path: String(args.path), line: Number(args.line), column: Number(args.column) };
  }
  const definition = native?.definitions?.[0];
  if (!definition) return null;
  return {
    path: definition.path,
    line: Number(definition.line || 1),
    column: Number(definition.column || 0) + 1
  };
}

function mergeReferences(native, lsp, workspaceAlias, symbol) {
  const nativeResult = native || {};
  const items = dedupeLocations([...(lsp.result || []), ...(nativeResult.items || [])]);
  const calls = items.filter(item => item.classification === 'call');
  return {
    ok: true,
    workspace: workspaceAlias,
    action: 'references',
    ...(symbol ? { symbol } : {}),
    ...nativeResult,
    items,
    matchCount: items.length,
    referenceCount: items.length,
    callCount: Math.max(Number(nativeResult.callCount || 0), calls.length),
    truncated: nativeResult.truncated === true,
    intelligence: evidence(lsp.provider, native ? ['relai-native'] : [], false, lsp.status)
  };
}

function mergeImpact(native = {}, lsp) {
  const existing = new Map((native.impactedPaths || []).map(item => [item.path, item]));
  for (const item of lsp.result || []) {
    if (!existing.has(item.path)) existing.set(item.path, { path: item.path, depth: 1, reason: 'lsp-reference' });
  }
  const affectedTests = new Set(native.affectedTests || []);
  for (const item of lsp.result || []) if (item.test) affectedTests.add(item.path);
  return {
    ...native,
    semanticReferences: lsp.result || [],
    impactedPaths: [...existing.values()].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
    impactedPathCount: existing.size,
    affectedTests: [...affectedTests].sort((a, b) => a.localeCompare(b)),
    intelligence: evidence(lsp.provider, ['relai-native'], false, lsp.status)
  };
}

function mergeTrace(native = {}, lsp) {
  const affectedTests = new Set(native.affectedTests || []);
  for (const item of lsp.result || []) if (item.test) affectedTests.add(item.path);
  return {
    ...native,
    semanticReferences: lsp.result || [],
    affectedTests: [...affectedTests].sort((a, b) => a.localeCompare(b)),
    intelligence: evidence(lsp.provider, ['relai-native'], false, lsp.status)
  };
}

function dedupeLocations(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.path}:${item.line}:${item.column || 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function attachFallback(native, lsp, reason, requestedAction = '') {
  if (!native) {
    return {
      ok: false,
      error: reason || 'No code-intelligence provider could answer this request.',
      intelligence: evidence('none', lsp?.provider ? [lsp.provider] : [], true, lsp?.status)
    };
  }
  return {
    ...native,
    ...(requestedAction ? { action: requestedAction, fallbackResultKind: native.action || 'native' } : {}),
    intelligence: evidence('relai-native', lsp?.provider ? [lsp.provider] : [], true, lsp?.status, reason)
  };
}

function evidence(primary, supporting = [], fallbackUsed = false, status = null, fallbackReason = '') {
  return {
    mode: primary === 'relai-native' && supporting.length === 0 ? 'native' : 'hybrid',
    primary,
    supporting,
    authority: primary === 'relai-native' ? 'repository-structural' : primary === 'none' ? 'none' : 'language-server',
    fallbackUsed,
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(status ? { providerStatus: status } : {})
  };
}

const codeIntelligence = createCodeIntelligenceService();

export { codeIntelligence };
