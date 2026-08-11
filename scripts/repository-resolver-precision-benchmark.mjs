import { performance } from 'node:perf_hooks';
import { parseSourceFile } from '../src/repository/intelligence/treeSitter.js';
import { RESOLVER_PRECISION_CASES } from '../test/fixtures/repository-resolver-precision-cases.mjs';

const started = performance.now();
const details = [];
let relationExpected = 0;
let relationHits = 0;
let realImportHits = 0;
let fakeImportHits = 0;
for (const item of RESOLVER_PRECISION_CASES) {
  const parsed = await parseSourceFile({ relativePath:item.path, source:item.source });
  let caseRelationHits = 0;
  for (const [type,target] of item.relations) {
    relationExpected += 1;
    if (parsed.relations.some(rel => rel.type === type && rel.targetName === target)) { relationHits += 1; caseRelationHits += 1; }
  }
  const realImport = parsed.imports.some(entry => entry.specifier === item.realImport);
  const fakeImport = parsed.imports.some(entry => entry.specifier === item.fakeImport);
  if (realImport) realImportHits += 1;
  if (fakeImport) fakeImportHits += 1;
  details.push({ language:item.language, parser:parsed.parser, parseError:parsed.parseError, realImport, fakeImport, relationHits:caseRelationHits, relationExpected:item.relations.length });
}
const elapsedMs = performance.now() - started;
const result = {
  cases: RESOLVER_PRECISION_CASES.length,
  languages: [...new Set(RESOLVER_PRECISION_CASES.map(item => item.language))],
  elapsedMs: Number(elapsedMs.toFixed(2)),
  relationRecall: relationExpected ? Number((relationHits / relationExpected).toFixed(4)) : 1,
  importRecall: Number((realImportHits / RESOLVER_PRECISION_CASES.length).toFixed(4)),
  fakeImportFalsePositives: fakeImportHits,
  fakeImportPrecision: fakeImportHits ? Number(((RESOLVER_PRECISION_CASES.length - fakeImportHits) / RESOLVER_PRECISION_CASES.length).toFixed(4)) : 1,
  details
};
const json = process.argv.includes('--json');
console.log(json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
if (result.relationRecall < 1 || result.importRecall < 1 || result.fakeImportFalsePositives !== 0 || details.some(item => item.parser !== 'tree-sitter' || item.parseError)) process.exitCode = 1;
