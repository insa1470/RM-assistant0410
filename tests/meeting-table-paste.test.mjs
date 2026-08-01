import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexHtml, /function formatPastedTableText/, 'meeting paste should include a table formatter');
assert.match(indexHtml, /function handleMeetingTablePaste/, 'meeting text areas should handle pasted tables');
assert.match(indexHtml, /clipboardData\?\.getData\('text\/plain'\)/, 'paste handler should read plain clipboard text');
assert.match(indexHtml, /displayWidth/, 'table formatter should account for Chinese character display width');
assert.match(indexHtml, /onpaste="handleMeetingTablePaste\(event\)"/, 'meeting editor should enable table paste formatting');
assert.match(indexHtml, /font-family:Consolas, 'Courier New', monospace/, 'meeting preview and export should preserve aligned plain text tables');
assert.match(indexHtml, /function meetingTextFontSize/, 'meeting preview should size pasted table text to the mobile layout');
assert.match(indexHtml, /Math\.max\(9/, 'meeting table preview should keep a readable minimum font size');
assert.match(indexHtml, /overflow-x:auto/, 'meeting table preview should allow horizontal scroll only after shrinking');
assert.match(indexHtml, /meeting-plain-table/, 'meeting pasted tables should render in a dedicated preview wrapper');
