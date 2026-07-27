# Note History and Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent per-video undo/redo for timestamp-note creation, body/subtitle edits, deletion, and clearing, with confirmation UI and safe asset cleanup.

**Architecture:** Store compact command records per video in a new IndexedDB `history` store and mark recoverable deletions with `deletedAt`. Repository methods own note/history transactions; background messages expose them; a small side-panel controller owns button/shortcut state while the existing renderer supplies per-card delete actions.

**Tech Stack:** Manifest V3 Edge extension, vanilla JavaScript ES modules, IndexedDB, Node test runner, fake-indexeddb, esbuild.

## Global Constraints

- Release version is `0.3.0`.
- History is persisted per video session and retains the latest 50 actions.
- Creating a video session is not undoable; creating a saved timestamp note is undoable.
- Body edit, subtitle edit, single-note delete, and current-video clear are undoable and redoable.
- Automatic transcription, sorting, settings, and ZIP export never create history actions.
- Delete and clear require confirmation; clear is one atomic history action.
- Destructive/history controls are disabled while editing, saving, or recording.
- Edge real-device acceptance is handed to the user; automated verification and packaging remain required.

---

### Task 1: Pure History State Model

**Files:**
- Create: `src/core/note-history.js`
- Create: `tests/note-history.test.js`

**Interfaces:**
- Produces: `NOTE_HISTORY_LIMIT`, `emptyNoteHistory(sessionId)`, `recordNoteAction(history, action)`, `undoNoteHistory(history)`, `redoNoteHistory(history)`, `referencedNoteIds(history)`.
- Action shape: `{ id, type, noteIds, before?, after?, createdAt }`, where `type` is `add-note`, `edit-body`, `edit-subtitle`, `delete-note`, or `clear-session`.

- [ ] **Step 1: Write failing state-transition tests**

```js
test("记录新动作清空反撤销栈并只保留最近 50 次", () => {
  let history = emptyNoteHistory("youtube:course");
  history = { ...history, redo: [{ id: "old-redo", type: "delete-note", noteIds: ["n0"] }] };
  for (let index = 0; index < 51; index += 1) {
    history = recordNoteAction(history, {
      id: `a${index}`,
      type: "add-note",
      noteIds: [`n${index}`],
      createdAt: index,
    });
  }
  assert.equal(history.undo.length, 50);
  assert.equal(history.undo[0].id, "a1");
  assert.deepEqual(history.redo, []);
});

test("撤销与反撤销在两个栈之间移动同一动作", () => {
  const recorded = recordNoteAction(emptyNoteHistory("youtube:course"), {
    id: "edit-1",
    type: "edit-body",
    noteIds: ["n1"],
    before: "旧正文",
    after: "新正文",
    createdAt: 1,
  });
  const undone = undoNoteHistory(recorded);
  assert.equal(undone.action.id, "edit-1");
  assert.equal(undone.history.undo.length, 0);
  assert.equal(undone.history.redo[0].id, "edit-1");
  assert.equal(redoNoteHistory(undone.history).action.id, "edit-1");
});
```

- [ ] **Step 2: Run tests and verify they fail because the module/API is absent**

Run: `node --test tests/note-history.test.js`
Expected: FAIL with module-not-found or missing export.

- [ ] **Step 3: Implement immutable stack helpers and action validation**

```js
export const NOTE_HISTORY_LIMIT = 50;
const ACTION_TYPES = new Set([
  "add-note", "edit-body", "edit-subtitle", "delete-note", "clear-session",
]);

export function emptyNoteHistory(sessionId) {
  return { sessionId, undo: [], redo: [], updatedAt: 0 };
}

export function recordNoteAction(history, action) {
  if (!ACTION_TYPES.has(action?.type) || !Array.isArray(action.noteIds)) {
    throw new Error("无效的笔记历史动作");
  }
  return {
    ...history,
    undo: [...history.undo, structuredClone(action)].slice(-NOTE_HISTORY_LIMIT),
    redo: [],
    updatedAt: action.createdAt,
  };
}
```

Implement `undoNoteHistory`/`redoNoteHistory` as immutable pop-and-push operations returning `{ action, history }` or `{ action: null, history }`. `referencedNoteIds` returns a `Set` of IDs from both stacks.

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/note-history.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/note-history.js tests/note-history.test.js
git commit -m "新增: 定义笔记撤销历史状态"
```

### Task 2: Transactional IndexedDB History Repository

**Files:**
- Modify: `src/core/storage.js`
- Modify: `tests/storage.test.js`

**Interfaces:**
- Consumes: pure history functions from Task 1.
- Produces: `commitSavedNote(id, changes, now)`, `editNoteBody(id, body, now)`, `editNoteSubtitle(id, text, now)`, `deleteSavedNote(id, now)`, `clearSessionNotes(sessionId, now)`, `undoNoteAction(sessionId, now)`, `redoNoteAction(sessionId, now)`, `getNoteHistoryState(sessionId)`.
- Existing `listNotes` and `listPendingTranscriptions` return only notes without `deletedAt`.

- [ ] **Step 1: Add failing fake-indexeddb tests for persistence and filtering**

```js
test("新增、修改、删除和跨实例撤销共享持久历史", async () => {
  const name = `history-${crypto.randomUUID()}`;
  const first = new VideoNotesRepository({ databaseName: name, indexedDB, IDBKeyRange });
  await first.putNote({ id: "n1", sessionId: "youtube:abc", status: "draft", body: "", createdAt: 1 });
  await first.commitSavedNote("n1", { status: "saved", body: "第一条" }, 10);
  await first.editNoteBody("n1", "修改后", 20);
  await first.deleteSavedNote("n1", 30);
  assert.deepEqual(await first.listNotes("youtube:abc"), []);
  first.close();

  const second = new VideoNotesRepository({ databaseName: name, indexedDB, IDBKeyRange });
  await second.undoNoteAction("youtube:abc", 40);
  assert.equal((await second.listNotes("youtube:abc"))[0].body, "修改后");
  await second.undoNoteAction("youtube:abc", 50);
  assert.equal((await second.getNote("n1")).body, "第一条");
  await second.destroy();
});
```

Add separate tests for: clear as one action, redo, unchanged edits creating no action, pending-transcription filtering, 50-action cleanup deleting unreachable note/assets, and a thrown updater leaving both note and history unchanged.

- [ ] **Step 2: Run storage tests and verify the new API fails**

Run: `node --test tests/storage.test.js`
Expected: FAIL because the repository history methods do not exist.

- [ ] **Step 3: Upgrade the schema and add transaction helpers**

```js
const DATABASE_VERSION = 2;

request.onupgradeneeded = () => {
  const database = request.result;
  // Preserve existing sessions/notes/assets creation.
  if (!database.objectStoreNames.contains("history")) {
    database.createObjectStore("history", { keyPath: "sessionId" });
  }
};
```

Implement one internal `mutateHistory(sessionId, now, callback)` transaction over `notes` and `history`. It loads the current history, lets `callback` update notes and return an action/result, records only real changes, writes the history, and resolves after transaction completion.

- [ ] **Step 4: Implement the public mutation methods**

```js
editNoteBody(id, value, now = Date.now()) {
  const next = String(value ?? "").trim();
  return this.mutateNoteValue(id, "body", next, "edit-body", now, (note) => ({
    ...note,
    body: next,
    userEditVersion: (note.userEditVersion ?? 0) + 1,
    updatedAt: now,
  }));
}

editNoteSubtitle(id, value, now = Date.now()) {
  const next = String(value ?? "").trim();
  return this.mutateNoteValue(id, "subtitleContext", next, "edit-subtitle", now, (note) => ({
    ...note,
    subtitleContext: next,
    updatedAt: now,
  }));
}
```

`commitSavedNote` records `add-note` only when the prior status was not `saved`. Delete/clear set `deletedAt`. Undo/redo applies the action direction and updates `updatedAt`; body undo/redo increments `userEditVersion` so later automatic transcription cannot overwrite user intent.

- [ ] **Step 5: Implement safe cleanup**

After a successful mutation, scan deleted notes in the affected session. Permanently delete only tombstones not referenced by either retained stack, then delete their `screenshotKey`/`audioKey` records. Cleanup is idempotent and must never remove a referenced tombstone.

- [ ] **Step 6: Run focused and regression storage tests**

Run: `node --test tests/note-history.test.js tests/storage.test.js tests/whisper-state.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/storage.js tests/storage.test.js
git commit -m "新增: 持久化可撤销笔记事务"
```

### Task 3: Background and Voice-Save Integration

**Files:**
- Modify: `src/background.js`
- Modify: `src/offscreen.js`
- Modify: `tests/manifest.test.js`
- Modify: `tests/storage.test.js`

**Interfaces:**
- Consumes: repository mutation methods from Task 2.
- Produces messages `DELETE_NOTE`, `CLEAR_SESSION_NOTES`, `UNDO_NOTE_ACTION`, `REDO_NOTE_ACTION`; `GET_ACTIVE_STATE` adds `history: { canUndo, canRedo }`.

- [ ] **Step 1: Add failing integration-contract assertions**

Assert that the background routes the four new messages to repository methods, `GET_ACTIVE_STATE` includes history availability, typed commit uses `commitSavedNote`, and offscreen voice persistence uses the same method before returning success.

- [ ] **Step 2: Run contract/storage tests and verify failure**

Run: `node --test tests/manifest.test.js tests/storage.test.js`
Expected: FAIL on missing message routes and save calls.

- [ ] **Step 3: Route typed/edit/delete/clear/history operations**

```js
case "UPDATE_NOTE_BODY":
  return { note: await repository.editNoteBody(message.noteId, message.body) };
case "UPDATE_NOTE_SUBTITLE":
  return { note: await repository.editNoteSubtitle(message.noteId, message.subtitleContext) };
case "DELETE_NOTE":
  return repository.deleteSavedNote(message.noteId);
case "CLEAR_SESSION_NOTES":
  return repository.clearSessionNotes(message.sessionId);
case "UNDO_NOTE_ACTION":
  return repository.undoNoteAction(message.sessionId);
case "REDO_NOTE_ACTION":
  return repository.redoNoteAction(message.sessionId);
```

Before session-wide operations, resolve the sender's current page context and require the supplied `sessionId` to match it.

- [ ] **Step 4: Record timestamp-note creation exactly once**

Use `commitSavedNote` for typed commit. In offscreen recording persistence, save the audio asset first and then atomically commit note fields plus `add-note` history. Remove the duplicate plain `putNote` transition in background. The recording-failure fallback also uses `commitSavedNote`, because it leaves a visible saved warning note.

- [ ] **Step 5: Return history availability and preserve tab isolation**

```js
const history = await repository.getNoteHistoryState(context.sessionId);
return {
  context,
  notes: await repository.listNotes(context.sessionId),
  history: { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 },
};
```

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test tests/manifest.test.js tests/storage.test.js tests/sidepanel-scope.test.js`
Expected: PASS.

```bash
git add src/background.js src/offscreen.js tests/manifest.test.js tests/storage.test.js
git commit -m "新增: 接入笔记历史后台命令"
```

### Task 4: History Controls and Shortcut Logic

**Files:**
- Create: `src/core/note-history-controls.js`
- Create: `tests/note-history-controls.test.js`

**Interfaces:**
- Produces: `historyControlState({ noteCount, canUndo, canRedo, blocked, pending })`, `historyShortcut(event)`, and `createHistoryOperationController({ request, refresh, showError })`.

- [ ] **Step 1: Write failing control-state and shortcut tests**

```js
test("编辑控件保留原生撤销，侧栏空白处映射撤销与反撤销", () => {
  assert.equal(historyShortcut({ key: "z", metaKey: true, target: { tagName: "TEXTAREA" } }), null);
  assert.equal(historyShortcut({ key: "z", metaKey: true, shiftKey: false, target: { tagName: "DIV" } }), "undo");
  assert.equal(historyShortcut({ key: "z", metaKey: true, shiftKey: true, target: { tagName: "DIV" } }), "redo");
});

test("忙碌时禁用全部变更按钮", () => {
  assert.deepEqual(historyControlState({
    noteCount: 2, canUndo: true, canRedo: true, blocked: true, pending: false,
  }), { deleteDisabled: true, clearDisabled: true, undoDisabled: true, redoDisabled: true });
});
```

- [ ] **Step 2: Run and verify module-not-found failure**

Run: `node --test tests/note-history-controls.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement pure state and exact keyboard matching**

Editable targets include `INPUT`, `TEXTAREA`, `SELECT`, and any element with `isContentEditable`. Ignore composing events, modified keys other than exactly Cmd/Ctrl+Z, and events originating inside an open dialog.

- [ ] **Step 4: Implement one-request-at-a-time controller**

The controller exposes `pending`, rejects duplicate operations while pending, calls `refresh` only after success, and calls `showError` without mutating local history on failure.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/note-history-controls.test.js`
Expected: PASS.

```bash
git add src/core/note-history-controls.js tests/note-history-controls.test.js
git commit -m "新增: 管理侧栏撤销控件状态"
```

### Task 5: Side-Panel Delete, Clear, Undo, and Redo UI

**Files:**
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.css`
- Modify: `src/sidepanel.js`
- Modify: `tests/manifest.test.js`
- Create: `tests/sidepanel-history-ui.test.js`

**Interfaces:**
- Consumes: history state from `GET_ACTIVE_STATE`, controller/shortcut logic from Task 4, and background commands from Task 3.
- Produces: accessible confirmation dialog, per-note delete buttons, toolbar controls, and user-visible operation results.

- [ ] **Step 1: Add failing DOM/source assertions**

Assert that the HTML has `undo-button`, `redo-button`, `clear-button`, and one `history-confirm-dialog` with labelled title/description and cancel/confirm buttons. Assert that rendered note actions include delete and route confirmation before `DELETE_NOTE`.

- [ ] **Step 2: Run UI tests and verify expected failure**

Run: `node --test tests/sidepanel-history-ui.test.js tests/manifest.test.js`
Expected: FAIL because controls and dialog do not exist.

- [ ] **Step 3: Add toolbar and dialog markup**

```html
<button id="undo-button" class="secondary-button" type="button" disabled>撤销</button>
<button id="redo-button" class="secondary-button" type="button" disabled>反撤销</button>
<button id="clear-button" class="danger-button" type="button" disabled>清空</button>
<button id="export-button" class="secondary-button" type="button" disabled>导出 ZIP</button>

<dialog id="history-confirm-dialog" aria-labelledby="history-confirm-title" aria-describedby="history-confirm-description">
  <form method="dialog" class="confirm-dialog-card">
    <h2 id="history-confirm-title"></h2>
    <p id="history-confirm-description"></p>
    <div class="confirm-dialog-actions">
      <button value="cancel" class="secondary-button">取消</button>
      <button id="history-confirm-button" value="confirm" class="danger-button">确认</button>
    </div>
  </form>
</dialog>
```

- [ ] **Step 4: Bind state, card deletion, and confirmations**

Store `canUndo`/`canRedo` from each active-state response. Add a delete button beside each card's edit button. `confirmHistoryAction` configures one pending callback, opens the modal, and sends nothing on cancel/close. Delete copy includes `formatTimestamp(note.seconds)`; clear copy includes the saved note count and says “可通过撤销恢复”。

- [ ] **Step 5: Bind toolbar, keyboard, and busy states**

Undo/redo send the current `sessionId`; clear sends the same session ID after confirmation. Recompute control disabled states whenever notes/history, recording, drafts, inline edits, or a history request changes. Prevent default only when a global shortcut is recognized and an operation can run.

- [ ] **Step 6: Style compact responsive controls and destructive actions**

Allow `.timeline-actions` to wrap at narrow side-panel widths. Use the existing neutral palette for undo/redo and a restrained red border/background for delete/clear/confirm. Keep all buttons keyboard focusable and preserve existing minimum 320 px layout.

- [ ] **Step 7: Run UI and regression tests**

Run: `node --test tests/sidepanel-history-ui.test.js tests/sidepanel-interaction.test.js tests/sidepanel-scope.test.js tests/manifest.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel.html src/sidepanel.css src/sidepanel.js src/core/note-history-controls.js tests/sidepanel-history-ui.test.js tests/manifest.test.js
git commit -m "新增: 提供笔记删除清空与撤销界面"
```

### Task 6: Documentation, Version, and Release Artifact

**Files:**
- Modify: `README.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/STORE_LISTING.md`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/manifest.test.js`
- Create: `artifacts/video-notes-edge-0.3.0.zip` through the package script.

**Interfaces:**
- Consumes: completed feature behavior from Tasks 1–5.
- Produces: user documentation, manual Edge checklist, synchronized release metadata, and installable ZIP.

- [ ] **Step 1: Update release/version test to expect `0.3.0` and verify failure**

Run: `node --test tests/manifest.test.js`
Expected: FAIL while metadata is still `0.2.2`.

- [ ] **Step 2: Update documentation and metadata**

Document deletion/clear confirmations, persistent 50-action history, keyboard shortcuts, soft-delete storage behavior, and the fact that new timestamp notes—but not new video sessions—are undoable. Add manual acceptance cases for typed/voice additions, body/subtitle edits, single delete, atomic clear, redo invalidation, cross-restart history, and asset recovery.

- [ ] **Step 3: Synchronize versions and lockfile**

Set Manifest, package metadata, and lockfile root package version to `0.3.0`.

- [ ] **Step 4: Run complete verification**

Run: `npm test`
Expected: all tests pass with zero failures.

Run: `npm run package`
Expected: creates `artifacts/video-notes-edge-0.3.0.zip`.

Run: `unzip -t artifacts/video-notes-edge-0.3.0.zip`
Expected: `No errors detected in compressed data`.

Run: `unzip -p artifacts/video-notes-edge-0.3.0.zip manifest.json | rg '"version": "0.3.0"'`
Expected: one match.

Run: `git diff --check`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/ACCEPTANCE.md docs/STORE_LISTING.md manifest.json package.json package-lock.json tests/manifest.test.js artifacts/video-notes-edge-0.3.0.zip
git commit -m "发布: 视频笔记 0.3.0"
```

## Self-Review Result

- Spec coverage: all approved operations, persistence, 50-action limit, busy-state rules, confirmation, asset recovery/cleanup, versioning, and user-owned Edge testing map to Tasks 1–6.
- Placeholder scan: no implementation placeholders remain.
- Type consistency: history action names, repository method names, background messages, and UI state fields are consistent across tasks.
