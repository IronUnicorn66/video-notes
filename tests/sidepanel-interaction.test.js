import assert from "node:assert/strict";
import test from "node:test";

import {
  createSidePanelInlineEditController,
  createSidePanelRefreshRunner,
} from "../src/core/sidepanel-interaction.js";

class FakeClassList {
  values = new Set();

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }
}

class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.contentEditable = "false";
    this.disabled = false;
    this.textContent = "";
    this.listeners = new Map();
  }

  addEventListener(type, handler, options = {}) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ handler, once: options.once === true });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? [])
      .filter((listener) => listener.handler !== handler));
  }

  dispatch(type, event = {}) {
    const results = [];
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      results.push(listener.handler(event));
      if (listener.once) this.removeEventListener(type, listener.handler);
    }
    return results;
  }

  click() {
    return this.dispatch("click")[0];
  }

  blur() {
    this.dispatch("blur");
  }

  focus() {}
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test("保存等待期间禁用重复编辑并使用提交时文本", async () => {
  const saveGate = deferred();
  const button = new FakeElement();
  const content = new FakeElement();
  const savedTexts = [];
  const applied = [];
  const editor = createSidePanelInlineEditController();
  editor.bind({
    noteId: "note-1",
    button,
    content,
    getInitialText: () => "历史正文",
    restore() {},
    save(text) {
      savedTexts.push(text);
      return saveGate.promise;
    },
    applySaved(response, submittedText) {
      applied.push({ response, submittedText });
    },
  });

  const session = button.click();
  content.textContent = "第一次提交";
  let prevented = false;
  content.dispatch("keydown", {
    isComposing: false,
    key: "Enter",
    metaKey: true,
    ctrlKey: false,
    preventDefault() { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(button.disabled, true);
  assert.deepEqual(savedTexts, ["第一次提交"]);
  assert.equal(button.click(), null);
  content.textContent = "提交后变化";

  saveGate.resolve({ note: { body: "第一次提交" } });
  await session.completion;
  assert.deepEqual(applied, [{
    response: { note: { body: "第一次提交" } },
    submittedText: "第一次提交",
  }]);
  assert.equal(button.disabled, false);
});

test("刷新响应应用前发现编辑会登记延迟刷新并丢弃响应", async () => {
  const loadGate = deferred();
  const applied = [];
  let blocked = false;
  let deferredRefreshes = 0;
  const refreshRunner = createSidePanelRefreshRunner({
    load: () => loadGate.promise,
    apply(value) { applied.push(value); },
    applyError(error) { throw error; },
    isBlocked: () => blocked,
    defer() { deferredRefreshes += 1; },
  });

  const refreshPromise = refreshRunner.run();
  blocked = true;
  loadGate.resolve({ notes: ["旧响应"] });

  assert.equal(await refreshPromise, false);
  assert.deepEqual(applied, []);
  assert.equal(deferredRefreshes, 1);
});

test("刷新开始后进入并结束编辑仍会废弃旧代次响应", async () => {
  const loadGate = deferred();
  const applied = [];
  let deferredRefreshes = 0;
  let editor;
  const refreshRunner = createSidePanelRefreshRunner({
    load: () => loadGate.promise,
    apply(value) { applied.push(value); },
    applyError(error) { throw error; },
    isBlocked: () => editor.blocked,
    defer() { deferredRefreshes += 1; },
  });
  editor = createSidePanelInlineEditController({
    onEditStarted() { refreshRunner.invalidateForEdit(); },
  });
  const button = new FakeElement();
  const content = new FakeElement();
  editor.bind({
    noteId: "note-1",
    button,
    content,
    getInitialText: () => "当前正文",
    restore() {},
    async save() {},
    applySaved() {},
  });

  const refreshPromise = refreshRunner.run();
  const session = button.click();
  content.dispatch("keydown", {
    isComposing: false,
    key: "Escape",
    metaKey: false,
    ctrlKey: false,
    preventDefault() {},
  });
  await session.completion;
  assert.equal(editor.blocked, false);

  loadGate.resolve({ notes: ["旧响应"] });
  assert.equal(await refreshPromise, false);
  assert.deepEqual(applied, []);
  assert.equal(deferredRefreshes, 1);
});

test("必须应用的刷新被更晚代次取代时会继续等待下一次应用", async () => {
  const loads = [];
  const applied = [];
  const refreshRunner = createSidePanelRefreshRunner({
    load() {
      const gate = deferred();
      loads.push(gate);
      return gate.promise;
    },
    apply(value) { applied.push(value); },
    applyError(error) { throw error; },
  });

  const requiredRefresh = refreshRunner.runUntilApplied();
  const newerRefresh = refreshRunner.run();
  assert.equal(loads.length, 2);

  loads[0].resolve("旧历史状态");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads.length, 3);
  assert.deepEqual(applied, []);

  loads[1].resolve("被重试取代的状态");
  assert.equal(await newerRefresh, false);
  assert.deepEqual(applied, []);

  loads[2].resolve("已应用的历史状态");
  assert.equal(await requiredRefresh, true);
  assert.deepEqual(applied, ["已应用的历史状态"]);
});

test("保存失败保留可见文本并允许点击重试", async () => {
  const firstSave = deferred();
  const secondSave = deferred();
  const saves = [firstSave, secondSave];
  let saveIndex = 0;
  const errors = [];
  const applied = [];
  const button = new FakeElement();
  const content = new FakeElement();
  const editor = createSidePanelInlineEditController({
    onError(error) { errors.push(error.message); },
  });
  editor.bind({
    noteId: "note-1",
    button,
    content,
    getInitialText: () => "历史字幕",
    restore() {},
    save() {
      const gate = saves[saveIndex];
      saveIndex += 1;
      return gate.promise;
    },
    applySaved(response, submittedText) {
      applied.push({ response, submittedText });
    },
  });

  const failedSession = button.click();
  content.textContent = "未保存字幕";
  content.blur();
  firstSave.reject(new Error("保存失败"));
  await failedSession.completion;

  assert.equal(content.textContent, "未保存字幕");
  assert.equal(button.disabled, false);
  assert.equal(editor.blocked, true);
  assert.deepEqual(errors, ["保存失败"]);

  const retrySession = button.click();
  assert.equal(content.textContent, "未保存字幕");
  content.blur();
  secondSave.resolve({ note: { subtitleContext: "未保存字幕" } });
  await retrySession.completion;

  assert.deepEqual(applied, [{
    response: { note: { subtitleContext: "未保存字幕" } },
    submittedText: "未保存字幕",
  }]);
  assert.equal(editor.blocked, false);
});

test("成功保存完成后只刷新一次延迟请求", async () => {
  const saveGate = deferred();
  let deferredRefresh = true;
  let flushes = 0;
  const button = new FakeElement();
  const content = new FakeElement();
  const editor = createSidePanelInlineEditController({
    flushDeferredRefresh() {
      if (!deferredRefresh) return false;
      deferredRefresh = false;
      flushes += 1;
      return true;
    },
  });
  editor.bind({
    noteId: "note-1",
    button,
    content,
    getInitialText: () => "历史字幕",
    restore() {},
    save: () => saveGate.promise,
    applySaved() {},
  });

  const session = button.click();
  content.textContent = "新字幕";
  content.blur();
  assert.equal(flushes, 0);

  saveGate.resolve({ note: { subtitleContext: "新字幕" } });
  await session.completion;
  assert.equal(flushes, 1);
  assert.equal(editor.blocked, false);
});
