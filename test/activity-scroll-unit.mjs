import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const css = read('src/ui/styles/app.css');
const activity = read('src/ui/features/activity/index.js');

const tableWrapRule = css.match(/\.table-wrap\s*\{([^}]*)\}/)?.[1] || '';
assert.match(activity, /class="table-wrap"/, 'Activity must render its event log inside the shared table wrapper');
assert.match(tableWrapRule, /overscroll-behavior-x:\s*contain/, 'horizontal table overscroll should remain contained');
assert.match(tableWrapRule, /overscroll-behavior-y:\s*auto/, 'vertical wheel and touch scrolling must chain to the Activity page');
assert.doesNotMatch(tableWrapRule, /overscroll-behavior:\s*contain/, 'the table wrapper must not trap vertical page scrolling');

console.log('Activity page scroll regression test passed.');
