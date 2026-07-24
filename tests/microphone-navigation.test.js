import assert from "node:assert/strict";
import test from "node:test";

const navigationModule = await import("../src/core/microphone-navigation.js").catch(() => ({}));

function createSessionStorage() {
  const values = new Map();
  return {
    async get(defaults) {
      return Object.fromEntries(
        Object.entries(defaults).map(([key, fallback]) => [key, values.get(key) ?? fallback]),
      );
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    async remove(keys) {
      for (const key of keys) values.delete(key);
    },
  };
}

test("后台重启后按标签当前窗口返回原课程", async () => {
  assert.equal(typeof navigationModule.createMicrophoneNavigation, "function");
  const storageSession = createSessionStorage();
  const calls = [];
  const firstWorker = navigationModule.createMicrophoneNavigation({
    storageSession,
    tabs: {},
    windows: {},
  });
  await firstWorker.rememberSource({ id: 42, windowId: 3 });

  const restartedWorker = navigationModule.createMicrophoneNavigation({
    storageSession,
    tabs: {
      async update(tabId, options) {
        calls.push(["tab", tabId, options]);
        return { id: tabId, windowId: 9 };
      },
    },
    windows: {
      async update(windowId, options) {
        calls.push(["window", windowId, options]);
      },
    },
  });

  assert.deepEqual(await restartedWorker.returnToSource(), { returned: true });
  assert.deepEqual(calls, [
    ["tab", 42, { active: true }],
    ["window", 9, { focused: true }],
  ]);
  assert.deepEqual(await storageSession.get({ microphonePermissionReturnTabId: -1 }), {
    microphonePermissionReturnTabId: -1,
  });
});

test("来源课程标签关闭后保留授权页并清理返回目标", async () => {
  assert.equal(typeof navigationModule.createMicrophoneNavigation, "function");
  const storageSession = createSessionStorage();
  const navigation = navigationModule.createMicrophoneNavigation({
    storageSession,
    tabs: {
      async update() {
        throw new Error("No tab with id");
      },
    },
    windows: {
      async update() {
        assert.fail("来源标签不存在时不应聚焦窗口");
      },
    },
  });
  await navigation.rememberSource({ id: 42, windowId: 3 });

  assert.deepEqual(await navigation.returnToSource(), { returned: false });
  assert.deepEqual(await storageSession.get({ microphonePermissionReturnTabId: -1 }), {
    microphonePermissionReturnTabId: -1,
  });
});

test("重复打开授权页时使用最后一次网课来源", async () => {
  assert.equal(typeof navigationModule.createMicrophoneNavigation, "function");
  const storageSession = createSessionStorage();
  let activatedTabId = null;
  const navigation = navigationModule.createMicrophoneNavigation({
    storageSession,
    tabs: {
      async update(tabId) {
        activatedTabId = tabId;
        return { id: tabId, windowId: 8 };
      },
    },
    windows: { async update() {} },
  });
  await navigation.rememberSource({ id: 10, windowId: 1 });
  await navigation.rememberSource({ id: 20, windowId: 2 });

  assert.deepEqual(await navigation.returnToSource(), { returned: true });
  assert.equal(activatedTabId, 20);
});
