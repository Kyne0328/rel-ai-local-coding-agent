import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const css = read('src/ui/styles/app.css');
const activityCss = read('src/ui/features/activity/styles.css');
const activity = read('src/ui/features/activity/index.js');

const tableWrapRule = css.match(/\.table-wrap\s*\{([^}]*)\}/)?.[1] || '';
const routeRootRule = css.match(/\.route-root\s*\{([^}]*)\}/)?.[1] || '';
const activityPageRule = activityCss.match(/\.activity-page\s*\{([^}]*)\}/)?.[1] || '';
const activityCardRule = activityCss.match(/\.activity-event-card\s*\{([^}]*)\}/)?.[1] || '';
const activityCardBodyRule = activityCss.match(/\.activity-event-card \.card-body\s*\{([^}]*)\}/)?.[1] || '';
const activityTableWrapRule = activityCss.match(/\.activity-event-card \.table-wrap\s*\{([^}]*)\}/)?.[1] || '';

assert.match(activity, /class="table-wrap"/, 'Activity must render its event log inside the shared table wrapper');
assert.match(css, /\.main\s*\{[^}]*@apply flex min-w-0 w-full flex-col/, 'the main dashboard column must expose remaining height to route content');
assert.match(routeRootRule, /@apply flex min-w-0 flex-col/, 'route content must use a vertical flex layout');
assert.match(routeRootRule, /flex:\s*1 0 auto/, 'route content must claim unused dashboard height without shrinking long pages');
assert.match(activityPageRule, /min-height:\s*0/, 'Activity must be allowed to shrink within the available route height'); // rigidity-ok: zero min-height is the flex overflow invariant that lets the inner panes scroll
assert.match(activityPageRule, /flex:\s*1 1 0/, 'Activity must fill available route height while allowing internal scrolling'); // rigidity-ok: the Activity route must grow and shrink inside the fixed desktop viewport
assert.match(activityCardRule, /@apply flex min-w-0 flex-col/, 'the event log card must lay out its header and body vertically');
assert.match(activityCardRule, /min-height:\s*0/, 'the event log card must allow its scroll panes to shrink'); // rigidity-ok: zero min-height prevents card content from forcing the route beyond the viewport
assert.match(activityCardRule, /flex:\s*1 1 0/, 'the event log card must fill remaining Activity height without forcing outer-page overflow'); // rigidity-ok: the card is the bounded vertical flex child for the master/detail panes
assert.match(activityCardBodyRule, /flex:\s*1 0 auto/, 'the event log body must fill the card');
assert.match(activityTableWrapRule, /flex:\s*1 0 auto/, 'the event log table wrapper must fill the body');
assert.match(activityCss, /\.activity-event-card \.table-wrap\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/, 'the event log wrapper must span the full card width'); // rigidity-ok: full-width wrapper is the semantic scroll-container invariant
assert.match(activityCss, /\.activity-table\s*\{[^}]*width:\s*100%/, 'the event log table must span the full wrapper width'); // rigidity-ok: table must fill the horizontal scroll wrapper
assert.match(tableWrapRule, /overscroll-behavior-x:\s*contain/, 'horizontal table overscroll should remain contained');
assert.match(tableWrapRule, /overscroll-behavior-y:\s*auto/, 'vertical wheel and touch scrolling must chain to the Activity page');
assert.doesNotMatch(tableWrapRule, /overscroll-behavior:\s*contain/, 'the table wrapper must not trap vertical page scrolling');

console.log('Activity page scroll regression test passed.');
