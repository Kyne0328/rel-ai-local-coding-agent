import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEcosystemResolver } from '../src/repository/intelligence/ecosystemResolution.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-ecosystem-resolution-'));
const write = (rel, text) => { const file=path.join(root,...rel.split('/')); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,text); };
try {
  write('go.mod','module example.com/acme\n');
  write('composer.json', JSON.stringify({autoload:{'psr-4':{'Acme\\':'src/'}}}));
  write('Cargo.toml','[package]\nname = "app"\n[dependencies]\nutil = { path = "crates/util" }\n');
  write('src/Shared/Shared.csproj','<Project Sdk="Microsoft.NET.Sdk"></Project>');
  write('compile_commands.json', JSON.stringify([{directory:root,arguments:['clang','-I','include','src/main.c']}]))
  write('pyproject.toml','[tool.setuptools]\npackage-dir = {"" = "packages"}\n');
  const paths=['go.mod','composer.json','Cargo.toml','src/Shared/Shared.csproj','compile_commands.json','pyproject.toml','packages/acme/service.py','src/main/java/com/acme/User.java','src/main/kotlin/com/acme/User.kt','include/acme/user.h','lib/acme/user.rb','crates/util/src/foo.rs'];
  const resolver=createEcosystemResolver(root,paths);
  assert.ok(resolver.candidates('go','cmd/main.go','example.com/acme/internal/user').includes('internal/user'));
  assert.ok(resolver.candidates('php','src/App.php','Acme/Service/User').includes('src/Service/User'));
  assert.ok(resolver.candidates('python','src/app.py','acme/service').includes('packages/acme/service'));
  assert.ok(resolver.candidates('java','src/main/java/com/acme/App.java','com/acme/User').includes('src/main/java/com/acme/User'));
  assert.ok(resolver.candidates('kotlin','src/main/kotlin/com/acme/App.kt','com/acme/User').includes('src/main/kotlin/com/acme/User'));
  assert.ok(resolver.candidates('c','src/main.c','acme/user.h').includes('include/acme/user.h'));
  assert.ok(resolver.candidates('ruby','lib/app.rb','acme/user').includes('lib/acme/user'));
  assert.ok(resolver.candidates('rust','src/main.rs','util/foo').includes('crates/util/src/foo'));
  assert.ok(resolver.candidates('csharp','src/App/App.cs','Shared/Thing').includes('src/Shared/Thing'));
  console.log('Ecosystem-aware module resolution tests passed.');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
