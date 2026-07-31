import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workerJs = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

assert.match(workerJs, /group_passcodes/, 'worker should create a group passcode table');
assert.match(workerJs, /leader_passcode_hash/, 'worker should store a separate group leader management code hash');
assert.match(workerJs, /handleGroupAuth/, 'worker should expose group passcode authentication');
assert.match(workerJs, /handleGroupRecords/, 'worker should expose read-only group records');
assert.match(workerJs, /handleSetGroupLeaderPasscode/, 'admin should reset group leader management codes');
assert.match(workerJs, /handleLeaderSetGroupPasscode/, 'group leaders should reset their own group view passcodes');
assert.match(workerJs, /hashPasscode/, 'worker should hash group passcodes instead of storing plaintext');
assert.match(workerJs, /type IN \('report','site'\)/, 'group records should only include reports and site records');
assert.match(workerJs, /rm_group = \?/, 'group records should be constrained to the authenticated group');
assert.match(workerJs, /ALLOWED_RM_GROUPS\.includes/, 'group records should reject unmanaged groups');

assert.match(indexHtml, /本组记录/, 'frontend should expose a same-group records tab');
assert.match(indexHtml, /group-records/, 'frontend should include a group records view');
assert.match(indexHtml, /api\/group-auth/, 'frontend should authenticate group passcodes through the worker');
assert.match(indexHtml, /api\/group-records/, 'frontend should load group records from the worker');
assert.match(indexHtml, /组长设置/, 'frontend should expose a leader settings entry');
assert.match(indexHtml, /api\/group-passcode/, 'frontend should let leaders reset the group view passcode');
assert.match(indexHtml, /leaderPasscode/, 'leader settings should use the group leader management code');
assert.match(indexHtml, /readOnlyGroupRecord/, 'frontend should render group records as read-only');

assert.match(adminHtml, /組長管理碼|组长管理码/, 'admin should expose group leader management code reset');
assert.match(adminHtml, /api\/admin\/group-leader-passcode/, 'admin should reset group leader management codes through the worker');
assert.match(adminHtml, /resetGroupLeaderPasscode/, 'admin should implement leader code reset action');
assert.doesNotMatch(adminHtml, /api\/admin\/group-passcode/, 'admin should not directly manage regular group view passcodes');
