import { codeIntelligence } from '../codeIntelligence/service.js';
import { isTestPath } from '../repository/intelligence/languages.js';

async function relaiCodeInspect(workspace, config, args = {}, context = {}) {
  return codeIntelligence.inspect(workspace, config, args, { signal: context.signal, watch: context.watch });
}

export { relaiCodeInspect, isTestPath };
