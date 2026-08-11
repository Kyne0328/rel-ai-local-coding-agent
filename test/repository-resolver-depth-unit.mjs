import assert from 'node:assert/strict';

import { enhancedResolverLanguages } from '../src/repository/intelligence/languages.js';
import { parseSourceFile } from '../src/repository/intelligence/treeSitter.js';

const CASES = [
  {
    path: 'src/service.py', language: 'python', provider: 'resolver-python-v1',
    source: 'from .models import BaseService\nfrom .util import save_record\nclass AccountService(BaseService):\n    def save(self):\n        service = BaseService()\n        return save_record(service)\n',
    relations: [['INHERITS', 'BaseService'], ['USES_TYPE', 'BaseService'], ['CALLS', 'save_record']],
    imports: ['./models', './util']
  },
  {"path":"src/AccountService.java","language":"java","provider":"resolver-java-v1","source":"import com.acme.BaseService;\nimport com.acme.Persistable;\nimport static com.acme.Util.saveRecord;\nclass AccountService extends BaseService implements Persistable {\n  void save() { BaseService service = new BaseService(); saveRecord(); }\n}\n","relations":[["INHERITS","BaseService"],["IMPLEMENTS","Persistable"],["USES_TYPE","BaseService"],["CALLS","saveRecord"]],"imports":["com/acme/BaseService","com/acme/Persistable","com/acme/Util"]},
  {"path":"src/AccountService.cs","language":"csharp","provider":"resolver-csharp-v1","source":"using BaseService = Acme.BaseService;\nusing Persistable = Acme.Persistable;\nclass AccountService : BaseService, Persistable {\n  void Save() { var service = new BaseService(); BaseService.Create(); }\n}\n","relations":[["INHERITS","BaseService"],["IMPLEMENTS","Persistable"],["USES_TYPE","BaseService"],["CALLS","Create"]],"imports":["Acme/BaseService","Acme/Persistable"]},
  {"path":"src/service.go","language":"go","provider":"resolver-go-v1","source":"package service\nimport (\n  base \"example.com/acme/base\"\n  util \"example.com/acme/util\"\n)\nfunc Save() {\n  var service base.Service\n  _ = service\n  base.NewService()\n  util.Save()\n}\n","relations":[["USES_TYPE","Service"],["CALLS","NewService"],["CALLS","Save"]],"imports":["example.com/acme/base","example.com/acme/util"]},
  {"path":"src/service.rs","language":"rust","provider":"resolver-rust-v1","source":"use crate::base::BaseService;\nuse crate::util::save_record;\ntrait Persistable { fn save(&self); }\nstruct AccountService;\nimpl Persistable for AccountService {\n  fn save(&self) {\n    let service = BaseService::new();\n    save_record();\n  }\n}\n","relations":[["IMPLEMENTS","Persistable"],["USES_TYPE","BaseService"],["CALLS","save_record"]],"imports":["base","util"]}
];

for (const item of CASES) {
  const parsed = await parseSourceFile({ relativePath: item.path, source: item.source });
  assert.equal(parsed.parser, 'tree-sitter', 'structural parser missing for ' + item.language);
  assert.equal(parsed.parseError, false, 'parse error for ' + item.language);
  assert.equal(parsed.resolver?.id, item.provider, 'resolver missing for ' + item.language);
  for (const [type, target] of item.relations) assert.ok(parsed.relations.some(rel => rel.type === type && rel.targetName === target), `${item.language} missing ${type}:${target}`);
  for (const specifier of item.imports) assert.ok(parsed.imports.some(entry => entry.specifier === specifier && entry.provider === item.provider), `${item.language} missing import ${specifier}`);
}

assert.deepEqual(enhancedResolverLanguages().sort(), ['csharp', 'go', 'java', 'javascript', 'python', 'rust', 'tsx', 'typescript']);
console.log('Repository Intelligence ecosystem resolver-depth tests passed.');
