import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexHtml, /客群/, 'form should label customer segments as 客群');
assert.match(indexHtml, /8\+E/, 'form should include 8+E segment option');
assert.match(indexHtml, /環金陸企/, 'form should include 環金陸企 segment option');
assert.match(indexHtml, /function toggleCustomerSegment\(/, 'front end should support toggling customer segments');
assert.match(indexHtml, /customerSegments:\[\]/, 'new report drafts should initialize customerSegments');
assert.match(indexHtml, /const customerSegments = getCustomerSegments\(record\)/, 'upload should normalize new and legacy customer segment data');
assert.match(indexHtml, /customerSegments,/, 'upload payload should include customerSegments');
assert.match(indexHtml, /is8PlusE:\s*customerSegments\.includes\('8\+E'\)/, 'is8PlusE should stay compatible with selected 8+E segment');
