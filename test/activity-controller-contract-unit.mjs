import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const activity = read('src/ui/features/activity/index.js');
const dashboard = read('public/dashboard.js');
const activityCss = read('src/ui/features/activity/styles.css');

assert.match(activity, /from '\.\/model\.js'/, 'Activity must use its pure data model');
assert.match(activity, /_allEntries = \[\]/, 'mounting Activity must discard stale module history');
assert.match(activity, /_liveEntriesSinceLoad = \[\]/, 'live entries received during history loading must be tracked');
assert.match(activity, /parseActivityHistoryResponse\(data\)/, 'structured fetch errors must be interpreted explicitly');
assert.match(activity, /replaceActivityHistory\(parsed\.entries\)/, 'stored history must be treated as an authoritative snapshot');
assert.match(activity, /_pausedEntries/, 'paused snapshots must be buffered');
assert.match(activity, /async function resumeLiveActivity/, 'resuming must reconcile buffered and stored history');
assert.match(activity, /mode:\s*'merge'/, 'resume reconciliation must merge a fresh history snapshot');
assert.match(activity, /if \(!merged\.changed\) return false;/, 'unchanged live snapshots must be no-ops');
assert.match(activity, /activityEntriesFingerprint/, 'table rendering must compare displayed entry content');
assert.match(activity, /_renderedEntriesFingerprint/, 'Activity must remember the rendered table fingerprint');
assert.match(activity, /relai:clock-tick/, 'time-range filters must age from the shared dashboard clock');
assert.match(activity, /nextActivityExpiry/, 'clock updates must only rerender at an expiration boundary');
assert.match(activity, /activityAbsoluteTime\(entry\)/, 'detail timestamps must use a validated fallback');
assert.match(activity, /activityActionLabel\(entry\)/, 'row actions must have distinguishable accessible labels');
assert.match(activity, /activity-message-copy">\$\{esc\(message\)\}<\/span>/, 'message text must be rendered before optional title metadata');
assert.match(activity, /activity-message-title/, 'event titles may be shown separately without obscuring messages');
assert.match(dashboard, /return module\.mergeEntries\(data\.auditTail\?\.entries \|\| \[\]\);/, 'the dashboard must respect Activity no-op updates');
assert.match(activityCss, /\.activity-message-copy\s*\{[^}]*min-width:\s*12ch/s, 'messages need a guaranteed readable width');
assert.match(activityCss, /\.activity-col-message\s*\{[^}]*width:\s*calc\(66% - 272px\)/s, 'fixed-layout Activity tables must allocate the full desktop remainder to Message');
assert.doesNotMatch(activityCss, /\.activity-col-message\s*\{[^}]*width:\s*auto/s, 'Message must not rely on fixed-table auto width when Workspace is hidden');
assert.match(activityCss, /@media \(max-width: 980px\)[\s\S]*\.activity-workspace-column[\s\S]*display:\s*none/s, 'workspace must yield space to messages before the mobile breakpoint');

console.log('Activity controller contract test passed.');
