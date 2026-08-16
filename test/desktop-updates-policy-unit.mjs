import assert from 'node:assert/strict';
import fs from 'node:fs';

import { releaseNotesHtml, supportPolicyView } from '../src/ui/features/settings/desktop-updates.js';

const updateUiSource = fs.readFileSync(new URL('../src/ui/features/settings/desktop-updates.js', import.meta.url), 'utf8');
assert.match(updateUiSource, /wireActions\(container, installedReleaseNotes\)/, 'update actions must retain bundled installed release notes');
assert.match(updateUiSource, /renderStatus\(container, result\.status, installedReleaseNotes\)/, 'successful update actions must retain bundled release notes');
assert.match(updateUiSource, /renderFailure\(container, messageOf\(error\), installedReleaseNotes\)/, 'failed update actions must retain bundled release notes');

assert.equal(supportPolicyView({ state: 'current', currentVersion: '0.25.0', minimumSupportedVersion: '0.25.0' }).label, 'Supported');
assert.equal(supportPolicyView({ state: 'required', currentVersion: '0.24.9', minimumSupportedVersion: '0.25.0' }).tone, 'bad');
assert.match(supportPolicyView({ state: 'required', currentVersion: '0.24.9', minimumSupportedVersion: '0.25.0' }).description, /v0\.25\.0/);
assert.match(supportPolicyView({ state: 'deprecated', currentVersion: '0.24.9', minimumSupportedVersion: '0.25.0', enforceAfter: '2026-09-01T00:00:00.000Z' }).description, /2026|September|Sep/);
assert.match(supportPolicyView({ state: 'unavailable' }).description, /keep using the app/i);

const availableNotes = releaseNotesHtml({
  state: 'available',
  availableVersion: '0.25.3',
  releaseNotes: [{ version: '0.25.3', note: 'Updater closes immediately.\nChangelog is now visible.' }]
});
assert.match(availableNotes, /What's new in v0\.25\.3/);
assert.match(availableNotes, /Updater closes immediately/);
assert.match(availableNotes, /Changelog is now visible/);

const installedNotes = releaseNotesHtml({ state: 'up_to_date' }, {
  version: '0.25.2',
  headline: 'Release notes',
  bullets: ['First change', 'Second change']
});
assert.match(installedNotes, /v0\.25\.2/);
assert.match(installedNotes, /First change/);

console.log('Desktop update support policy and release-note view tests passed.');
