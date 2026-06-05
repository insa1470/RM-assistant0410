import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexHtml, /meeting-editor-modal/, 'meeting editor should include a full-screen editing modal');
assert.match(indexHtml, /openMeetingTextEditor/, 'meeting text fields should be expandable for focused editing');
assert.match(indexHtml, /applyMeetingTextEditorValue/, 'expanded meeting editor should write changes back to the draft');
assert.match(indexHtml, /closeMeetingTextEditor/, 'expanded meeting editor should close without changing the meeting flow');
assert.match(indexHtml, /展开编辑/, 'meeting fields should expose a compact expand action');
assert.match(indexHtml, /会议预览/, 'meeting edit screen should offer a preview entry before export');
assert.match(indexHtml, /updateDailySection\([\s\S]*saveDraft/, 'daily meeting sections should keep existing draft-saving behavior');
assert.match(indexHtml, /updateDeptContent\([\s\S]*saveDraft/, 'department discussion updates should keep existing draft-saving behavior');
assert.match(indexHtml, /updateQuadrant\([\s\S]*saveDraft/, 'todo quadrant updates should keep existing draft-saving behavior');
