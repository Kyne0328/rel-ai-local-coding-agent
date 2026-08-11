import assert from 'node:assert/strict';

import { languageForPath, parserForLanguage } from '../src/repository/intelligence/languages.js';
import { parseSourceFile } from '../src/repository/intelligence/treeSitter.js';

const CASES = [
  {
    "path": "infra/config.hcl",
    "language": "hcl",
    "source": "service = { name = \"relai\" }\n"
  },
  {
    "path": "infra/main.tf",
    "language": "terraform",
    "source": "resource \"null_resource\" \"example\" {}\n"
  },
  {
    "path": "db/schema.sql",
    "language": "sql",
    "source": "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n"
  },
  {"path":"scripts/example.ps1","language":"powershell","source":"function GetRelAI { Write-Output 1 }\n"},
  {"path":"scripts/example.ps1","language":"powershell","source":"function GetRelAI { Write-Output 1 }\n"},
  {"path":"README.md","language":"markdown","source":"# Rel.AI\n\nRepository intelligence.\n"},
  {"path":"docs/page.mdx","language":"markdown","source":"# Rel.AI MDX\n\nStructured markdown content.\n"},
  {"path":"Dockerfile","language":"dockerfile","source":"FROM node:24-alpine\nWORKDIR /app\nCOPY . .\n"},
  {"path":"schema.graphql","language":"graphql","source":"type Query { hello: String! }\nquery Hello { hello }\n"},
  {"path":"api/service.proto","language":"protobuf","source":"syntax = \"proto3\";\nmessage User { string name = 1; }\n"},
  {"path":"analysis/model.r","language":"r","source":"add <- function(x, y) { x + y }\n"}
];

for (const item of CASES) {
  assert.equal(languageForPath(item.path), item.language, 'language mapping failed for ' + item.path);
  const asset = parserForLanguage(item.language);
  assert.ok(asset?.path?.startsWith('vendor/tree-sitter/'), 'vendored parser path missing for ' + item.language);
  const parsed = await parseSourceFile({ relativePath: item.path, source: item.source });
  assert.equal(parsed.parser, 'tree-sitter', 'Tree-sitter parser did not load for ' + item.language);
  assert.equal(parsed.parseError, false, 'Tree-sitter parse error for ' + item.language);
}

console.log('Vendored Repository Intelligence structural language parser tests passed.');
