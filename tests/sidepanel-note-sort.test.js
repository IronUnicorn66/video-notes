import assert from "node:assert/strict";
import test from "node:test";

const sidepanelSort = await import("../src/core/sidepanel-note-sort.js").catch(() => ({}));
const { sortNotesForDisplay } = await import("../src/core/note-sort-order.js");
const { createSidePanelRefreshController } = await import("../src/core/sidepanel-scope.js");

class FakeButton {
  constructor(order) {
    this.dataset = { noteSortOrder: order };
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = {
      values: new Set(),
      toggle: (name, active) => {
        if (active) this.classList.values.add(name);
        else this.classList.values.delete(name);
      },
      contains: (name) => this.classList.values.has(name),
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  click() {
    this.listeners.get("click")?.();
  }
}

function createFixture({ editing = false, storageSet } = {}) {
  const oldest = new FakeButton("oldest");
  const newest = new FakeButton("newest");
  const notes = [
    { id: "old", createdAt: 100 },
    { id: "new", createdAt: 200 },
  ];
  const rendered = [];
  let isEditing = editing;
  const binding = sidepanelSort.createSidepanelNoteSortBinding({
    buttons: [oldest, newest],
    storage: { local: { set: storageSet ?? (async () => {}) } },
    getNotes: () => notes,
    renderNotes: (nextNotes, order) => {
      rendered.push(sortNotesForDisplay(nextNotes, order).map(({ id }) => id));
    },
    isEditing: () => isEditing,
    showToast: () => {},
  });

  return {
    binding,
    newest,
    oldest,
    rendered,
    setEditing(value) {
      isEditing = value;
    },
  };
}

test("点击正序按钮会更新选中状态、保存 noteSortOrder 并重排列表", async () => {
  const saves = [];
  const fixture = createFixture({ storageSet: async (value) => saves.push(value) });

  fixture.binding.initialize("newest");
  fixture.rendered.length = 0;
  fixture.oldest.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.oldest.getAttribute("aria-pressed"), "true");
  assert.equal(fixture.oldest.classList.contains("is-active"), true);
  assert.equal(fixture.newest.getAttribute("aria-pressed"), "false");
  assert.deepEqual(fixture.rendered, [["old", "new"]]);
  assert.deepEqual(saves, [{ noteSortOrder: "oldest" }]);
});

test("保存排序偏好失败时保留界面选择并显示提示", async () => {
  const toasts = [];
  const fixture = createFixture({
    storageSet: async () => {
      throw new Error("存储不可用");
    },
  });
  fixture.binding = sidepanelSort.createSidepanelNoteSortBinding({
    buttons: [fixture.oldest, fixture.newest],
    storage: { local: { set: async () => { throw new Error("存储不可用"); } } },
    getNotes: () => [],
    renderNotes: () => {},
    isEditing: () => false,
    showToast: (message) => toasts.push(message),
  });

  fixture.binding.initialize("newest");
  fixture.oldest.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.oldest.getAttribute("aria-pressed"), "true");
  assert.deepEqual(toasts, ["存储不可用"]);
});

test("外部同步在编辑时仅更新按钮，编辑完成后才按新顺序重排且延后刷新只执行一次", () => {
  const fixture = createFixture({ editing: true });
  let refreshes = 0;
  const refreshController = createSidePanelRefreshController(
    () => { refreshes += 1; },
    { shouldDeferRefresh: () => true },
  );
  refreshController.setTabId(1);

  fixture.binding.initialize("newest");
  fixture.rendered.length = 0;
  refreshController.handleContextChanged({ type: "NOTE_TRANSCRIBED", tabId: 1 });
  fixture.binding.sync("oldest");

  assert.equal(fixture.oldest.getAttribute("aria-pressed"), "true");
  assert.deepEqual(fixture.rendered, []);
  assert.equal(refreshes, 0);

  fixture.setEditing(false);
  assert.equal(fixture.binding.finishEditing(), true);
  assert.deepEqual(fixture.rendered, [["old", "new"]]);
  assert.equal(refreshController.flushDeferredRefresh(), true);
  assert.equal(refreshController.flushDeferredRefresh(), false);
  assert.equal(refreshes, 1);
});

test("延后上下文刷新接管重排时会清除排序待渲染标记", () => {
  const fixture = createFixture({ editing: true });

  fixture.binding.initialize("newest");
  fixture.binding.sync("oldest");
  fixture.setEditing(false);

  assert.equal(fixture.binding.finishEditing({ render: false }), true);
  assert.deepEqual(fixture.rendered, []);
  assert.equal(fixture.binding.finishEditing(), false);
});

test("读取偏好失败时仍用默认值完成侧栏启动", async () => {
  const oldest = new FakeButton("oldest");
  const newest = new FakeButton("newest");
  const binding = sidepanelSort.createSidepanelNoteSortBinding({
    buttons: [oldest, newest],
    storage: { local: { set: async () => {} } },
    getNotes: () => [],
    renderNotes: () => {},
    isEditing: () => false,
    showToast: () => {},
  });
  const shortcuts = [];
  const tabIds = [];
  let refreshes = 0;

  await sidepanelSort.initializeSidepanel({
    storage: { local: { get: async () => { throw new Error("存储不可用"); } } },
    onShortcutCode: (code) => shortcuts.push(code),
    noteSortBinding: binding,
    setPanelContext: async () => tabIds.push(7),
    refresh: async () => { refreshes += 1; },
    renderWhisperStatus: async () => {},
    renderPermissionStatus: async () => {},
  });

  assert.deepEqual(shortcuts, ["AltRight"]);
  assert.equal(newest.getAttribute("aria-pressed"), "true");
  assert.equal(oldest.getAttribute("aria-pressed"), "false");
  assert.deepEqual(tabIds, [7]);
  assert.equal(refreshes, 1);
});
