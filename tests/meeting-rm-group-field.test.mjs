import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexHtml, /const isGroupMeeting = isTodo \|\| isDaily/, 'todo and daily meetings should be identified as group meetings');
assert.match(indexHtml, /id="meeting-rm-group-row"/, 'group meetings should show an RM group field in meeting info');
assert.match(indexHtml, /updateMeetingRmGroup/, 'meeting RM group field should use a dedicated updater');
assert.match(indexHtml, /300[\s\S]*301[\s\S]*302[\s\S]*303[\s\S]*305[\s\S]*306[\s\S]*321[\s\S]*322[\s\S]*323/, 'meeting RM group field should include the admin group and managed groups');
assert.match(indexHtml, /value\.includes\('主管'\)[\s\S]*updateDraft\('rmGroup',''\)/, 'switching to supervisor meeting should clear RM group');
assert.match(indexHtml, /draft\.type === 'meeting'[\s\S]*isGroupMeetingName\(draft\.meetingName\)[\s\S]*!draft\.rmGroup/, 'todo and daily meetings should require RM group before export');
assert.match(indexHtml, /rmGroup:\s+record\.type === 'meeting' \? \(isGroupMeetingName\(record\.meetingName\) \? record\.rmGroup : null\)/, 'only todo and daily meeting uploads should persist RM group');
