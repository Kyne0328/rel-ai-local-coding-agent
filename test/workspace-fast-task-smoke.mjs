#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeConfig } = require('../src/config.js');
const { updateWorkspace } = require('../src/configEditor.js');
const { collectTextFiles } = require('../src/safety.js');
const { repoSnapshot } = require('../src/localRepoBridge.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-fast-'));
const configPath = path.join(tmp, 'config.json');
process.env.REL_AI_MCP_CONFIG = configPath;
const repo = path.join(tmp, 'repo');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.mkdirSync(path.join(repo, '.dart_tool'), { recursive: true });
fs.mkdirSync(path.join(repo, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src', 'app.js'), `export function app() {}\n`);
fs.writeFileSync(path.join(repo, '.dart_tool', 'noise.txt'), `noise\n`);
fs.writeFileSync(path.join(repo, 'node_modules', 'noise.js'), `noise\n`);
fs.writeFileSync(path.join(repo, '.relaiignore'), `tmp-cache/\n`);
fs.mkdirSync(path.join(repo, 'tmp-cache'), { recursive: true });
fs.writeFileSync(path.join(repo, 'tmp-cache', 'ignored.txt'), `ignored\n`);

let config = normalizeConfig({ workspaces: { app: { path: repo, fastTask: { maxIndexFiles: 1, includeRoots: ['src'] } } } });
assert.equal(config.workspaces.app.fastTask.enabled, true);
assert.ok(config.workspaces.app.fastTask.excludePaths.includes('.dart_tool'));
const snapshot = repoSnapshot({ alias: 'app', ...config.workspaces.app }, config);
assert.equal(snapshot.effectiveMaxEntries, 1, 'workspace index limit must control the default repository overview size');
assert.deepEqual(snapshot.files, ['src/app.js']);

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
let updated = updateWorkspace(config, { action: 'upsert', alias: 'app', path: repo, fastTask: { enabled: false, maxIndexFiles: 123, includeRoots: ['src'], excludePaths: ['custom-cache'] }, confirmDangerous: true });
assert.equal(updated.ok, true);
assert.equal(updated.config.workspaces.find(w => w.alias === 'app').fastTask.enabled, false);
assert.equal(updated.config.workspaces.find(w => w.alias === 'app').fastTask.maxIndexFiles, 123);

const tree = collectTextFiles(repo);
assert.ok(tree.files.includes('src/app.js'));
assert.ok(!tree.files.includes('.dart_tool/noise.txt'));
assert.ok(!tree.files.includes('node_modules/noise.js'));
assert.ok(!tree.files.includes('tmp-cache/ignored.txt'));

updated = updateWorkspace(JSON.parse(fs.readFileSync(configPath, 'utf8')), { action: 'delete', alias: 'app', confirmDelete: true });
assert.equal(updated.ok, true);
assert.equal(updated.config.workspaces.some(w => w.alias === 'app'), false);
console.log('workspace fast task smoke passed');
