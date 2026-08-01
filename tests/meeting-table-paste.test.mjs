import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexHtml, /function formatPastedTableText/, 'meeting paste should include a table formatter');
assert.match(indexHtml, /function handleMeetingTablePaste/, 'meeting text areas should handle pasted tables');
assert.match(indexHtml, /clipboardData\?\.getData\('text\/plain'\)/, 'paste handler should read plain clipboard text');
assert.match(indexHtml, /displayWidth/, 'table formatter should account for Chinese character display width');
assert.match(indexHtml, /onpaste="handleMeetingTablePaste\(event\)"/, 'meeting editor should enable table paste formatting');
assert.match(indexHtml, /font-family:Consolas, 'Courier New', monospace/, 'meeting preview and export should preserve aligned plain text tables');
