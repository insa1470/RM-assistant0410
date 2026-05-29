import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

assert.match(indexHtml, /record\.type === 'meeting' \? \{[\s\S]*chairman/, 'meeting uploads should include chairman in tmpl_json');
assert.match(indexHtml, /record\.type === 'meeting' \? \{[\s\S]*recorder/, 'meeting uploads should include recorder in tmpl_json');
assert.match(indexHtml, /record\.type === 'meeting' \? \{[\s\S]*attendeeText/, 'meeting uploads should include attendee text in tmpl_json');
assert.match(indexHtml, /record\.type === 'meeting' \? \{[\s\S]*dailySections/, 'meeting uploads should include daily meeting sections in tmpl_json');
assert.match(indexHtml, /record\.type === 'meeting' \? \{[\s\S]*discussions/, 'meeting uploads should include department discussions in tmpl_json');
assert.match(indexHtml, /record\.type === 'meeting' \? \{[\s\S]*todoQuadrants/, 'meeting uploads should include todo quadrants in tmpl_json');

assert.match(adminHtml, /renderMeetingDetail/, 'admin detail modal should render saved meeting content');
assert.match(adminHtml, /主席/, 'admin meeting details should show chairman');
assert.match(adminHtml, /记录/, 'admin meeting details should show recorder');
assert.match(adminHtml, /出席人员/, 'admin meeting details should show attendees');
assert.match(adminHtml, /各部门讨论事项|会议内容摘要|待办四象限/, 'admin meeting details should show saved meeting body sections');
