import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.doesNotMatch(indexHtml, /wrapEmailLine/, 'call report exports should not hard-wrap text by fixed character count');
assert.match(indexHtml, /function normalizeReportParagraph/, 'call report exports should normalize pasted line breaks');
assert.match(indexHtml, /buildTmplText[\s\S]*normalizeReportParagraph\(clauses\.join\('。'\)\)/, 'template summary should keep each numbered item as one paragraph');
assert.match(indexHtml, /contentList \|\| \[\]\)\.map\(normalizeReportParagraph\)/, 'copied call report details should normalize paragraph-internal line breaks');
assert.match(indexHtml, /todoList \|\| \[\]\)\.map\(normalizeReportParagraph\)/, 'copied call report todos should normalize paragraph-internal line breaks');
assert.match(indexHtml, /draft\.contentList\.map\(normalizeReportParagraph\)/, 'Word call report details should normalize paragraph-internal line breaks');
assert.match(indexHtml, /draft\.todoList\.map\(normalizeReportParagraph\)/, 'Word call report todos should normalize paragraph-internal line breaks');
