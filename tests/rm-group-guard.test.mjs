import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const workerJs = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');

assert.match(indexHtml, /function sanitizeRmGroup\(/, 'front end should define sanitizeRmGroup');
assert.match(indexHtml, /function updateRmGroup\(/, 'front end should define updateRmGroup');
assert.match(indexHtml, /inputmode="numeric"/g, 'RM group inputs should open a numeric keyboard');
assert.match(indexHtml, /pattern="\[0-9\]\*"/g, 'RM group inputs should declare a numeric pattern');
assert.match(indexHtml, /oninput="updateRmGroup\(this\)"/g, 'RM group inputs should sanitize while typing');
assert.match(indexHtml, /請輸入數字組別/, 'preview should block blank or non-numeric RM groups');
assert.match(workerJs, /const rmGroupClean = sanitizeRmGroup\(rmGroup\);/, 'worker should sanitize rmGroup');
assert.match(workerJs, /function sanitizeRmGroup\(/, 'worker should define sanitizeRmGroup');
assert.match(workerJs, /RM 組別僅能填寫數字/, 'worker should reject non-numeric rmGroup values');
