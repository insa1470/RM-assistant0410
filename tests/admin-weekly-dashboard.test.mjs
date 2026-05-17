import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminHtml = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const workerJs = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');

assert.match(adminHtml, /週管理總覽/, 'admin dashboard should lead with weekly management overview');
assert.match(adminHtml, /RM 組別週管理/, 'admin dashboard should include the RM group weekly matrix');
assert.match(adminHtml, /近 10 工作日拜訪趨勢/, 'admin dashboard should preserve the recent 10 workday trend');
assert.match(adminHtml, /renderGroupWeeklyMatrix/, 'admin dashboard should render the group weekly matrix');
assert.match(adminHtml, /GROUP_TARGETS/, 'admin dashboard should define weekly targets by RM group');
assert.match(adminHtml, /ALLOWED_RM_GROUPS/, 'admin dashboard should explicitly limit the matrix to the 8 managed RM groups');
assert.doesNotMatch(adminHtml, /groupMap\.keys\(\)/, 'admin dashboard should not add unmanaged RM groups such as 198 to the matrix');
assert.match(adminHtml, /环金/, 'admin dashboard should expose the shortened 环金 customer segment');
assert.doesNotMatch(adminHtml, /資料品質提醒|組代號未填|組代號異常|會議已排除/, 'admin dashboard should not show data quality reminder chips');
assert.doesNotMatch(adminHtml, /行銷目標設定|活動類型|chart-type|renderTypeChart/, 'admin dashboard should remove target settings and activity type sections');
assert.match(adminHtml, /匯出管理報表 HTML/, 'admin dashboard should provide HTML management report export');
assert.match(adminHtml, /function exportManagementReportHTML\(/, 'admin dashboard should implement HTML management report export');
assert.match(adminHtml, /<option value="all" selected>全部資料<\/option>/, 'admin dashboard should default to all-time stats');
assert.match(adminHtml, /ADMIN_WEEKLY_VISITS = 1\.5/, 'weekly target should be fixed at 1.5 visits per person');
assert.match(adminHtml, /const range = 'all'/, 'admin dashboard should request all-time stats by default');
assert.match(adminHtml, /formatSegmentLine/, 'RM weekly cells should conditionally show only non-zero customer segment ratios');
assert.doesNotMatch(adminHtml, new RegExp(String.raw`\$\{count\} / \$\{target\}|\$\{count\}/\$\{groupTarget\}`), 'RM weekly cells should not show raw count over target text');

assert.match(workerJs, /groupWeeklyMatrix/, 'stats API should return group weekly matrix data');
assert.doesNotMatch(workerJs, /dataQuality|unmanaged_rm_group|missing_rm_group|invalid_rm_group|excluded_meetings/, 'stats API should not return data quality reminder fields');
assert.match(workerJs, /json_extract\(.*customerSegments/, 'stats API should read customer segments from tmpl_json');
assert.match(workerJs, /type IN \('report','site'\)/, 'marketing stats should include reports and site visits while excluding meetings');
assert.match(workerJs, /ALLOWED_RM_GROUPS/, 'stats API should define the 8 managed RM groups');
assert.match(workerJs, /rm_group IN \(\$\{allowedGroupSql\}\)/, 'stats API should count only the managed RM groups');
assert.match(workerJs, /range\) === 'all'/, 'stats API should support all-time dashboard stats');
assert.doesNotMatch(workerJs, /date\\('now', '-84 days'\\)|date\\('now', '-91 days'\\)/, 'weekly data should not be limited to recent 84 or 91 days');
