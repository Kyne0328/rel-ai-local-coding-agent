import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/features/activity/styles.css', 'utf8');

assert.doesNotMatch(css, /\.activity-col-message\s*\{[^}]*width:\s*calc\(/s, 'Message must use the same simple percentage-width model as the other Activity columns');
assert.match(css, /\.activity-col-time\s*\{[^}]*width:\s*9%/s, 'desktop Time width must be percentage based');
assert.match(css, /\.activity-col-tool\s*\{[^}]*width:\s*19%/s, 'desktop Tool width must be percentage based');
assert.match(css, /\.activity-col-workspace\s*\{[^}]*width:\s*15%/s, 'desktop Workspace width must be percentage based');
assert.match(css, /\.activity-col-status\s*\{[^}]*width:\s*11%/s, 'desktop Status width must be percentage based');
assert.match(css, /\.activity-col-message\s*\{[^}]*width:\s*39%/s, 'desktop Message width must be a normal percentage column');
assert.match(css, /\.activity-col-action\s*\{[^}]*width:\s*7%/s, 'desktop Actions width must be percentage based');
assert.match(css, /@media \(max-width:\s*980px\)[\s\S]*\.activity-col-message\s*\{[^}]*width:\s*42%/s, 'Message must remain a normal percentage column below 980px');
assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.activity-col-message\s*\{[^}]*width:\s*68%/s, 'Message must remain a normal percentage column on mobile');
assert.match(css, /@media \(max-width:\s*240px\)[\s\S]*\.activity-col-message\s*\{[^}]*width:\s*100%/s, 'Narrowest layout must give Message the full table width');
assert.match(css, /\.activity-message-copy\s*\{[^}]*min-width:\s*12ch/s, 'Message text must retain a readable minimum width');
assert.match(css, /@media \(max-width:\s*980px\)[\s\S]*\.activity-workspace-column[\s\S]*display:\s*none/s, 'Workspace must yield space to Message before the mobile breakpoint');

console.log('Activity message layout regression test passed.');
