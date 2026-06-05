import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexHtml, /meeting-editor-modal/, 'meeting editor should include a full-screen editing modal');
assert.match(indexHtml, /openMeetingTextEditor/, 'meeting text fields should be expandable for focused editing');
assert.match(indexHtml, /applyMeetingTextEditorValue/, 'expanded meeting editor should write changes back to the draft');
assert.match(indexHtml, /closeMeetingTextEditor/, 'expanded meeting editor should close without changing the meeting flow');
assert.match(indexHtml, /展开编辑/, 'meeting fields should expose a compact expand action');
assert.match(indexHtml, /会议预览/, 'meeting edit screen should offer a preview entry before export');
assert.match(indexHtml, /meeting-dept-/, 'selected department blocks should have stable anchors');
assert.match(indexHtml, /meeting-daily-section-/, 'daily meeting sections should have stable anchors');
assert.match(indexHtml, /meeting-todo-section/, 'todo meeting quadrants should have a stable anchor');
assert.match(indexHtml, /changeMeetingType/, 'meeting type changes should keep the user near the relevant editing area');
assert.match(indexHtml, /scrollMeetingAnchorIntoView/, 'meeting buttons should keep the user near the newly opened editor block');
assert.match(indexHtml, /scrollMeetingDeptIntoView/, 'selecting any department should keep the user near the new editor block');
assert.match(indexHtml, /scrollMeetingDailySectionIntoView/, 'adding a daily meeting section should keep the user near the new section');
assert.match(indexHtml, /rememberMeetingEditAnchor/, 'editing a meeting text area should remember its current block');
assert.match(indexHtml, /restoreMeetingEditAnchor/, 'finishing inline meeting edits should keep the user near the current block');
assert.match(indexHtml, /returnAnchorId/, 'closing the expanded meeting editor should return to the original block');
assert.match(indexHtml, /updateDailySection\([\s\S]*saveDraft/, 'daily meeting sections should keep existing draft-saving behavior');
assert.match(indexHtml, /updateDeptContent\([\s\S]*saveDraft/, 'department discussion updates should keep existing draft-saving behavior');
assert.match(indexHtml, /updateQuadrant\([\s\S]*saveDraft/, 'todo quadrant updates should keep existing draft-saving behavior');
