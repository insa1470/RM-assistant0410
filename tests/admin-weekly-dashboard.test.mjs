import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminHtml = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const workerJs = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');

assert.match(adminHtml, /週管理總覽/, 'admin dashboard should lead with weekly management overview');
assert.match(adminHtml, /RM 組別週管理/, 'admin dashboard should include the RM group weekly matrix');
assert.match(adminHtml, /近 10 工作日拜訪趨勢/, 'admin dashboard should preserve the recent 10 workday trend');
assert.match(adminHtml, /renderGroupWeeklyMatrix/, 'admin dashboard should render the group weekly matrix');
assert.match(adminHtml, /GROUP_TARGETS/, 'admin dashboard should define weekly targets by RM group');
assert.match(adminHtml, /环金/, 'admin dashboard should expose the shortened 环金 customer segment');
assert.match(adminHtml, /資料品質提醒/, 'admin dashboard should show data quality reminders');
assert.match(adminHtml, /匯出管理報表 HTML/, 'admin dashboard should provide HTML management report export');
assert.match(adminHtml, /function exportManagementReportHTML\(/, 'admin dashboard should implement HTML management report export');
assert.match(adminHtml, /value="1\.5"/, 'weekly target should default to 1.5 visits per person');
assert.match(adminHtml, /<option value="7" selected>/, 'admin dashboard should default to the recent 7 day weekly view');
assert.match(adminHtml, /parseFloat\(document\.getElementById\('target-weekly'\)/, 'weekly target should support half-step goals');

assert.match(workerJs, /groupWeeklyMatrix/, 'stats API should return group weekly matrix data');
assert.match(workerJs, /dataQuality/, 'stats API should return data quality reminders');
assert.match(workerJs, /json_extract\(.*customerSegments/, 'stats API should read customer segments from tmpl_json');
assert.match(workerJs, /type IN \('report','site'\)/, 'marketing stats should include reports and site visits while excluding meetings');
