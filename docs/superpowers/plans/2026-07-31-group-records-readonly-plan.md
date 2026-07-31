# Group Records Readonly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only “本組紀錄” feature so users can view complete same-group report/site records after entering a group passcode.

**Architecture:** Keep the current single-file frontend and Cloudflare Worker shape. Add three narrowly scoped Worker endpoints for group passcode setup, group auth, and group record reads; add one frontend tab inside the existing history screen that uses the new endpoints and reuses existing detail rendering. Preserve existing admin and record upload/export behavior.

**Tech Stack:** Static HTML/vanilla JavaScript, Cloudflare Worker, D1 SQL, Node-based text regression tests.

---

### Task 1: Worker API and Migration Coverage

**Files:**
- Modify: `worker/index.js`
- Create: `tests/group-records-readonly.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/group-records-readonly.test.mjs` with assertions that require:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workerJs = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(workerJs, /group_passcodes/, 'worker should create a group passcode table');
assert.match(workerJs, /handleGroupAuth/, 'worker should expose group passcode authentication');
assert.match(workerJs, /handleGroupRecords/, 'worker should expose read-only group records');
assert.match(workerJs, /handleSetGroupPasscode/, 'admin should be able to reset group passcodes');
assert.match(workerJs, /hashPasscode/, 'worker should hash group passcodes instead of storing plaintext');
assert.match(workerJs, /type IN \\('report','site'\\)/, 'group records should only include reports and site records');
assert.match(workerJs, /rm_group = \\?/, 'group records should be constrained to the authenticated group');
assert.match(workerJs, /ALLOWED_RM_GROUPS\\.includes/, 'group records should reject unmanaged groups');
assert.doesNotMatch(workerJs, /groupRecords[\\s\\S]{0,800}meeting/, 'group records should not intentionally include meeting rows');

assert.match(indexHtml, /本组记录/, 'frontend should expose a same-group records tab');
assert.match(indexHtml, /group-records/, 'frontend should include a group records view');
assert.match(indexHtml, /api\\/group-auth/, 'frontend should authenticate group passcodes through the worker');
assert.match(indexHtml, /api\\/group-records/, 'frontend should load group records from the worker');
assert.match(indexHtml, /readOnlyGroupRecord/, 'frontend should render group records as read-only');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/group-records-readonly.test.mjs`

Expected: FAIL on missing `group_passcodes` or `handleGroupAuth`.

- [ ] **Step 3: Implement Worker API**

Add routes:

```js
if (path === '/api/group-auth' && request.method === 'POST') return await handleGroupAuth(request, env);
if (path === '/api/group-records' && request.method === 'GET') return await handleGroupRecords(request, env);
if (path === '/api/admin/group-passcode' && request.method === 'POST') return await handleSetGroupPasscode(request, env);
```

Add helpers:

```js
async function hashPasscode(passcode, env) {
  const salt = env.GROUP_PASSCODE_SALT || env.ADMIN_PASSWORD || 'rm-assistant';
  const input = new TextEncoder().encode(`${salt}:${String(passcode || '')}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeGroupToken(rmGroup, passcodeHash) {
  return btoa(`${rmGroup}:${passcodeHash.slice(0, 24)}`);
}
```

Implement:

- `handleGroupAuth`: validates group in `ALLOWED_RM_GROUPS`, looks up `group_passcodes`, compares hash, returns `{ success:true, rmGroup, token }`.
- `handleGroupRecords`: validates `rmGroup` and token, returns `SELECT * FROM records WHERE rm_group = ? AND type IN ('report','site')`.
- `handleSetGroupPasscode`: admin-only, validates group, hashes supplied or generated passcode, upserts table, returns generated plaintext once.
- `handleSetup` and `handleMigrate`: create `group_passcodes`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/group-records-readonly.test.mjs`

Expected: PASS.

### Task 2: Frontend Same-Group Records

**Files:**
- Modify: `index.html`
- Test: `tests/group-records-readonly.test.mjs`

- [ ] **Step 1: Extend failing test if needed**

Keep the Task 1 test red until frontend strings and functions exist.

- [ ] **Step 2: Implement minimal frontend**

Add to the existing history screen:

- a segmented control with `我的记录 | 本组记录`
- `groupRecordsMode`
- `groupAuth` in localStorage
- `renderGroupRecordsAuth()`
- `authenticateGroupRecords()`
- `loadGroupRecords()`
- `renderGroupRecordsList()`
- `openGroupRecordDetail(id)`

Use existing record detail structure where possible. Mark detail records with `readOnlyGroupRecord = true`; do not show delete/edit actions for group records.

- [ ] **Step 3: Run the feature test**

Run: `node tests/group-records-readonly.test.mjs`

Expected: PASS.

### Task 3: Regression and Deployment

**Files:**
- Test all `tests/*.test.mjs`
- Deploy Worker with `npx wrangler deploy`
- Push `main`

- [ ] **Step 1: Run all tests**

Run: `for f in tests/*.test.mjs; do node "$f" || exit 1; done`

Expected: PASS.

- [ ] **Step 2: Run Worker syntax check**

Run: `node --check worker/index.js`

Expected: no syntax errors.

- [ ] **Step 3: Commit only relevant files**

Stage:

```bash
git add worker/index.js index.html tests/group-records-readonly.test.mjs docs/superpowers/plans/2026-07-31-group-records-readonly-plan.md
git commit -m "Add readonly group records"
```

- [ ] **Step 4: Deploy and push**

Run:

```bash
git push origin main
npx wrangler deploy
```

Expected: GitHub push succeeds and Worker deploy reports a current version ID.
