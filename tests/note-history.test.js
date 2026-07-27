import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyNoteHistory,
  recordNoteAction,
  referencedNoteIds,
  redoNoteHistory,
  undoNoteHistory,
} from "../src/core/note-history.js";

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

test("拒绝未知动作类型和缺少笔记 ID 的动作", () => {
  const history = emptyNoteHistory("youtube:course");

  assert.throws(
    () => recordNoteAction(history, { type: "unknown", noteIds: [], createdAt: 1 }),
    /无效的笔记历史动作/,
  );
  assert.throws(
    () => recordNoteAction(history, { type: "add-note", createdAt: 1 }),
    /无效的笔记历史动作/,
  );
});

test("聚合撤销栈和反撤销栈引用的笔记 ID", () => {
  const history = {
    ...emptyNoteHistory("youtube:course"),
    undo: [{ id: "a1", type: "edit-body", noteIds: ["n1", "n2"] }],
    redo: [{ id: "a2", type: "delete-note", noteIds: ["n2", "n3"] }],
  };

  assert.deepEqual([...referencedNoteIds(history)].sort(), ["n1", "n2", "n3"]);
});

test("空历史的撤销和反撤销不改变状态", () => {
  const history = emptyNoteHistory("youtube:course");

  assert.deepEqual(undoNoteHistory(history), { action: null, history });
  assert.deepEqual(redoNoteHistory(history), { action: null, history });
});
