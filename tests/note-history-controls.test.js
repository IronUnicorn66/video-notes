import assert from "node:assert/strict";
import test from "node:test";

import {
  createHistoryConfirmationController,
  createHistoryOperationController,
  historyControlState,
  historyOperationSuccessMessage,
  historyShortcut,
} from "../src/core/note-history-controls.js";

test("四类历史操作使用各自的简短成功提示", () => {
  assert.deepEqual([
    "DELETE_NOTE",
    "CLEAR_SESSION_NOTES",
    "UNDO_NOTE_ACTION",
    "REDO_NOTE_ACTION",
  ].map((type) => historyOperationSuccessMessage(type)), [
    "已删除标记",
    "已清空标记",
    "已撤销",
    "已反撤销",
  ]);
});

test("确认操作快照会话、标签页和笔记且只在上下文未变化时执行", async () => {
  let context = { token: 1, sessionId: "youtube:a", tabId: 7 };
  const requests = [];
  const controller = createHistoryConfirmationController({
    getContext: () => context,
    isBlocked: () => false,
    run: async (action) => requests.push(action),
  });

  assert.deepEqual(controller.open({ operation: "delete", noteId: "note-a" }), {
    operation: "delete",
    noteId: "note-a",
    token: 1,
    sessionId: "youtube:a",
    tabId: 7,
  });
  context = { token: 2, sessionId: "youtube:b", tabId: 8 };

  assert.equal(controller.revalidate(), false);
  assert.equal(await controller.confirm(), false);
  assert.deepEqual(requests, []);
  assert.equal(await controller.confirm(), false);
});

test("确认框打开后进入忙碌状态不会执行待定操作", async () => {
  let blocked = false;
  const requests = [];
  const controller = createHistoryConfirmationController({
    getContext: () => ({ token: 1, sessionId: "youtube:a", tabId: 7 }),
    isBlocked: () => blocked,
    run: async (action) => requests.push(action),
  });

  controller.open({ operation: "clear" });
  blocked = true;
  assert.equal(controller.revalidate(), false);
  blocked = false;

  assert.equal(await controller.confirm(), false);
  assert.deepEqual(requests, []);
});

test("取消或关闭确认框会清空快照且不执行请求", async () => {
  const requests = [];
  const controller = createHistoryConfirmationController({
    getContext: () => ({ token: 1, sessionId: "youtube:a", tabId: 7 }),
    isBlocked: () => false,
    run: async (action) => requests.push(action),
  });

  controller.open({ operation: "delete", noteId: "note-a" });
  assert.equal(controller.cancel(), true);
  assert.equal(await controller.confirm(), false);
  assert.deepEqual(requests, []);
});

test("上下文稳定时确认使用打开时快照执行", async () => {
  const requests = [];
  const context = { token: 3, sessionId: "youtube:a", tabId: 7 };
  const controller = createHistoryConfirmationController({
    getContext: () => context,
    isBlocked: () => false,
    run: async (action) => requests.push(action),
  });

  controller.open({ operation: "delete", noteId: "note-a" });

  assert.equal(await controller.confirm(), true);
  assert.deepEqual(requests, [{
    operation: "delete",
    noteId: "note-a",
    token: 3,
    sessionId: "youtube:a",
    tabId: 7,
  }]);
});

test("忙碌或无可用动作时禁用对应历史控件", () => {
  assert.deepEqual(historyControlState({
    noteCount: 0,
    canUndo: false,
    canRedo: false,
    blocked: false,
    pending: false,
  }), {
    deleteDisabled: true,
    clearDisabled: true,
    undoDisabled: true,
    redoDisabled: true,
  });

  assert.deepEqual(historyControlState({
    noteCount: 2,
    canUndo: true,
    canRedo: true,
    blocked: true,
    pending: false,
  }), {
    deleteDisabled: true,
    clearDisabled: true,
    undoDisabled: true,
    redoDisabled: true,
  });

  assert.deepEqual(historyControlState({
    noteCount: 2,
    canUndo: true,
    canRedo: true,
    blocked: false,
    pending: true,
  }), {
    deleteDisabled: true,
    clearDisabled: true,
    undoDisabled: true,
    redoDisabled: true,
  });
});

test("编辑控件、输入法和确认框保留快捷键", () => {
  const commandEvent = { key: "z", metaKey: true, target: { tagName: "DIV" } };

  for (const target of [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "DIALOG", open: true },
  ]) {
    assert.equal(historyShortcut({ ...commandEvent, target }), null);
  }
  assert.equal(historyShortcut({ ...commandEvent, isComposing: true }), null);
});

test("侧栏空白处只映射精确的 Cmd 或 Ctrl 加 Z", () => {
  const target = { tagName: "DIV" };

  assert.equal(historyShortcut({ key: "z", metaKey: true, target }), "undo");
  assert.equal(historyShortcut({ key: "Z", ctrlKey: true, shiftKey: true, target }), "redo");

  for (const event of [
    { key: "z", target },
    { key: "z", metaKey: true, ctrlKey: true, target },
    { key: "z", metaKey: true, altKey: true, target },
    { key: "y", ctrlKey: true, target },
  ]) {
    assert.equal(historyShortcut(event), null);
  }
});

test("历史操作串行请求，成功刷新，失败仅报告错误", async () => {
  let resolveRequest;
  const requests = [];
  let refreshCount = 0;
  const errors = [];
  const controller = createHistoryOperationController({
    request: (operation) => new Promise((resolve) => {
      requests.push(operation);
      resolveRequest = resolve;
    }),
    refresh: async () => {
      refreshCount += 1;
    },
    showError: (error) => errors.push(error.message),
  });

  const firstOperation = controller.run("undo");
  assert.equal(controller.pending, true);
  assert.equal(await controller.run("redo"), false);
  assert.deepEqual(requests, ["undo"]);

  resolveRequest();
  assert.equal(await firstOperation, true);
  assert.equal(controller.pending, false);
  assert.equal(refreshCount, 1);

  const failingController = createHistoryOperationController({
    request: async () => {
      throw new Error("操作失败");
    },
    refresh: async () => {
      refreshCount += 1;
    },
    showError: (error) => errors.push(error.message),
  });

  assert.equal(await failingController.run("redo"), false);
  assert.equal(failingController.pending, false);
  assert.equal(refreshCount, 1);
  assert.deepEqual(errors, ["操作失败"]);
});

test("删除清空撤销和反撤销只在请求及刷新成功后反馈", async () => {
  const successes = [];
  const controller = createHistoryOperationController({
    request: async () => {},
    refresh: async () => {},
    showError() {},
    showSuccess: (operation) => successes.push(operation.type),
  });

  for (const type of [
    "DELETE_NOTE",
    "CLEAR_SESSION_NOTES",
    "UNDO_NOTE_ACTION",
    "REDO_NOTE_ACTION",
  ]) {
    assert.equal(await controller.run({ type }), true);
  }
  assert.deepEqual(successes, [
    "DELETE_NOTE",
    "CLEAR_SESSION_NOTES",
    "UNDO_NOTE_ACTION",
    "REDO_NOTE_ACTION",
  ]);

  for (const failure of ["request", "refresh"]) {
    const failingController = createHistoryOperationController({
      request: async () => {
        if (failure === "request") throw new Error("请求失败");
      },
      refresh: async () => {
        if (failure === "refresh") throw new Error("刷新失败");
      },
      showError() {},
      showSuccess: (operation) => successes.push(operation.type),
    });
    assert.equal(await failingController.run({ type: "UNDO_NOTE_ACTION" }), false);
  }
  assert.equal(successes.length, 4);
});
