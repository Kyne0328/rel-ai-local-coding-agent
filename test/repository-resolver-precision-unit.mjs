import assert from 'node:assert/strict';
import { parseSourceFile } from '../src/repository/intelligence/treeSitter.js';
import { RESOLVER_PRECISION_CASES } from './fixtures/repository-resolver-precision-cases.mjs';

for (const item of RESOLVER_PRECISION_CASES) {
  const parsed = await parseSourceFile({ relativePath:item.path, source:item.source });
  assert.equal(parsed.parser, 'tree-sitter', item.path);
  assert.equal(parsed.parseError, false, item.path);
  assert.ok(parsed.imports.some(entry => entry.specifier === item.realImport), `${item.path} missing real import ${item.realImport}`);
  assert.equal(parsed.imports.some(entry => entry.specifier === item.fakeImport), false, `${item.path} accepted fake syntax from string/comment`);
  for (const [type,target] of item.relations) assert.ok(parsed.relations.some(rel => rel.type === type && rel.targetName === target), `${item.path} missing ${type}:${target}`);
}
const pythonQualified = await parseSourceFile({ relativePath:'src/qualified.py', source:'import pkg.models as models\nclass Service(models.BaseService):\n    pass\n' });
const pythonBases = pythonQualified.relations.filter(rel => rel.type === 'INHERITS');
assert.equal(pythonBases.length, 1);
assert.equal(pythonBases[0].targetName, 'BaseService');
assert.equal(pythonBases[0].moduleSpecifier, 'pkg/models');

const javaGeneric = await parseSourceFile({ relativePath:'src/Generic.java', source:'import real.Persistable;\nclass Generic implements Persistable<String> {}\n' });
const javaInterfaces = javaGeneric.relations.filter(rel => rel.type === 'IMPLEMENTS');
assert.equal(javaInterfaces.length, 1);
assert.equal(javaInterfaces[0].targetName, 'Persistable');
assert.equal(javaInterfaces[0].moduleSpecifier, 'real/Persistable');

const csharpGeneric = await parseSourceFile({ relativePath:'src/Generic.cs', source:'using Base = Acme.Base;\nusing Contract = Acme.Contract;\nclass Generic : Base<int>, Contract<string> {}\n' });
assert.ok(csharpGeneric.relations.some(rel => rel.type === 'INHERITS' && rel.targetName === 'Base'));
assert.ok(csharpGeneric.relations.some(rel => rel.type === 'IMPLEMENTS' && rel.targetName === 'Contract'));
assert.equal(csharpGeneric.relations.some(rel => ['int','string'].includes(rel.targetName)), false);

const cppGeneric = await parseSourceFile({ relativePath:'src/generic.cpp', source:'class Generic : public Base<int> {};\n' });
const cppBases = cppGeneric.relations.filter(rel => rel.type === 'INHERITS');
assert.equal(cppBases.length, 1);
assert.equal(cppBases[0].targetName, 'Base');
console.log('AST-gated resolver precision and framework semantics tests passed.');

