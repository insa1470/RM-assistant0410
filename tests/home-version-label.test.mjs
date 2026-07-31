import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexHtml, />RM Assistant V5</, 'home header should show RM Assistant V5');
assert.doesNotMatch(indexHtml, /RM Assistant V4\.5/, 'home header should not show the old V4.5 label');
