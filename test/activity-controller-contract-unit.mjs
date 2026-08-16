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
assert.doesNotMatch(activity, /activityEntriesFingerprint/, 'Activity must not serialize the full event list just to detect live changes');
assert.match(activity, /_entriesRevision/, 'Activity must track list changes with a cheap revision');
assert.match(activity, /_renderedTableKey/, 'Activity must remember a compact render key');
assert.match(activity, /sorted:\s*true/, 'Activity must avoid re-sorting its canonical already-sorted history during filtering');
assert.match(activity, /relai:clock-tick/, 'time-range filters must age from the shared dashboard clock');
assert.match(activity, /nextActivityExpiry/, 'clock updates must only rerender at an expiration boundary');
assert.match(activity, /activityAbsoluteTime\(entry\)/, 'detail timestamps must use a validated fallback');
assert.match(activity, /activityActionLabel\(entry\)/, 'row actions must have distinguishable accessible labels');
assert.match(activity, /activity-message-copy">\$\{esc\(message\)\}<\/span>/, 'message text must be rendered before optional title metadata');
assert.match(activity, /activity-message-title/, 'event titles may be shown separately without obscuring messages');
assert.match(dashboard, /return module\.updateActivityLiveState\(data\);/, 'the dashboard must delegate live Activity updates to the feature controller');
assert.match(dashboard, /if \(!updated\) return false;/, 'the dashboard must respect Activity no-op updates');
assert.match(activityCss, /\.activity-message-copy\s*\{[^}]*min-width:/s, 'messages need an explicit readable minimum width');
assert.match(activityCss, /\.activity-col-message\s*\{[^}]*width:\s*\d+(?:\.\d+)?%/s, 'fixed-layout Activity tables must give Message an explicit share of the row');
assert.doesNotMatch(activityCss, /\.activity-col-message\s*\{[^}]*width:\s*auto/s, 'Message must not rely on fixed-table auto width when Workspace is hidden');
assert.match(activityCss, /@media\s*\(max-width:[^)]+\)[\s\S]*\.activity-workspace-column[\s\S]*display:\s*none/s, 'a narrower layout must let Workspace yield space to messages');

console.log('Activity controller contract test passed.');
