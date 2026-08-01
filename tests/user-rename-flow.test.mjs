import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const workerJs = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');

assert.match(indexHtml, /id="name-cancel-btn"/, 'name modal should keep a stable cancel button');
assert.match(indexHtml, /setNameModalMode/, 'name modal should switch modes without rebuilding buttons');
assert.doesNotMatch(indexHtml, /name-modal-btns[\s\S]{0,500}\.innerHTML/, 'rename flow should not rebuild modal buttons');
assert.match(indexHtml, /showNamePrompt\(true\)/, 'home screen should still expose rename entry');
assert.match(indexHtml, /\.hero-card::before,\s*\.hero-card::after[\s\S]*pointer-events:\s*none/, 'hero card decoration layers should not intercept rename clicks');
assert.match(indexHtml, /\.hero-card > \*[\s\S]*z-index:\s*1/, 'hero card content should sit above decorative layers');

assert.match(workerJs, /api\/admin\/rename-user/, 'worker should expose an admin rename-user route');
assert.match(workerJs, /handleRenameUser/, 'worker should implement admin user rename handler');
assert.match(workerJs, /UPDATE records SET user_name = \? WHERE user_name = \?/, 'rename should update existing record owner names');

assert.doesNotMatch(adminHtml, /資料填寫人改名|资料填写人改名/, 'admin should not expose low-frequency user rename management on the dashboard');
assert.doesNotMatch(adminHtml, /api\/admin\/rename-user/, 'admin UI should not call the hidden rename-user maintenance API');
assert.doesNotMatch(adminHtml, /renameUserRecords/, 'admin UI should not include a rename action');
