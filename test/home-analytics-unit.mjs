import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.readFileSync(path.join(root, 'src/ui/features/home/index.js'), 'utf8');

assert.doesNotMatch(home, /loadAnalyticsData|homeAnalytics|data-home-analytics/, 'Overview must not duplicate the dedicated Usage page.');
assert.match(home, /connectionHero/, 'Overview must keep the current connection state.');
assert.match(home, /attentionCard/, 'Overview must keep actionable warnings.');
assert.match(home, /workspaceSummaryCard/, 'Overview must keep the project summary.');
assert.match(home, /recentTasksCard/, 'Overview must keep recent task context.');

console.log('Overview stays focused on current state and does not duplicate Usage.');
