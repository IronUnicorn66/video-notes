import assert from "node:assert/strict";
import test from "node:test";

const sidepanelZoom = await import("../src/core/sidepanel-zoom.js").catch(() => ({}));
const {
  createSidepanelZoomBinding,
  normalizeSidepanelZoom,
  sidepanelZoomAfterWheel,
} = sidepanelZoom;

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
    this.listenerOptions = new Map();
  }

  addEventListener(type, listener, options) {
    this.listeners.set(type, listener);
    this.listenerOptions.set(type, options);
  }

  wheel({ ctrlKey = false, metaKey = false, deltaY = 0 } = {}) {
    const event = {
      ctrlKey,
      metaKey,
      deltaY,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    this.listeners.get("wheel")?.(event);
    return event;
  }
}

function createFixture({ storageSet } = {}) {
  const target = new FakeEventTarget();
  const root = { style: { zoom: "" } };
  const saves = [];
  const toasts = [];
  const binding = createSidepanelZoomBinding({
    target,
    root,
    storage: {
      local: {
        set: storageSet ?? (async (value) => {
          saves.push(value);
        }),
      },
    },
    showToast(message) {
      toasts.push(message);
    },
  });

  return {
    binding,
    root,
    saves,
    toasts,
    listenerOptions: target.listenerOptions.get("wheel"),
    wheel: (event) => target.wheel(event),
  };
}

test("缩放比例使用默认值并限制在 75% 到 200%", () => {
  assert.equal(normalizeSidepanelZoom(undefined), 100);
  assert.equal(normalizeSidepanelZoom(Number.NaN), 100);
  assert.equal(normalizeSidepanelZoom(60), 75);
  assert.equal(normalizeSidepanelZoom(240), 200);
  assert.equal(normalizeSidepanelZoom(130), 130);
});

test("滚轮方向按 10% 调整并停在边界", () => {
  assert.equal(sidepanelZoomAfterWheel(100, -1), 110);
  assert.equal(sidepanelZoomAfterWheel(100, 1), 90);
  assert.equal(sidepanelZoomAfterWheel(200, -1), 200);
  assert.equal(sidepanelZoomAfterWheel(75, 1), 75);
  assert.equal(sidepanelZoomAfterWheel(120, 0), 120);
});

test("初始化应用保存的缩放比例", () => {
  const fixture = createFixture();
  fixture.binding.initialize(130);

  assert.equal(fixture.binding.zoom, 130);
  assert.equal(fixture.root.style.zoom, "1.3");
  assert.deepEqual(fixture.listenerOptions, { passive: false });
});

test("Ctrl 或 Command 加滚轮会缩放、保存并提示", async () => {
  const fixture = createFixture();
  fixture.binding.initialize(100);

  const ctrlEvent = fixture.wheel({ ctrlKey: true, deltaY: -1 });
  assert.equal(ctrlEvent.defaultPrevented, true);
  assert.equal(fixture.root.style.zoom, "1.1");

  const metaEvent = fixture.wheel({ metaKey: true, deltaY: 1 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(metaEvent.defaultPrevented, true);
  assert.equal(fixture.root.style.zoom, "1");
  assert.deepEqual(fixture.saves, [{ sidepanelZoom: 110 }, { sidepanelZoom: 100 }]);
  assert.deepEqual(fixture.toasts, ["侧栏缩放 110%", "侧栏缩放 100%"]);
});

test("普通滚轮、零位移和边界外滚轮不产生多余副作用", async () => {
  const fixture = createFixture();
  fixture.binding.initialize(200);

  const plainEvent = fixture.wheel({ deltaY: 1 });
  const zeroEvent = fixture.wheel({ ctrlKey: true, deltaY: 0 });
  const boundaryEvent = fixture.wheel({ ctrlKey: true, deltaY: -1 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(plainEvent.defaultPrevented, false);
  assert.equal(zeroEvent.defaultPrevented, false);
  assert.equal(boundaryEvent.defaultPrevented, true);
  assert.deepEqual(fixture.saves, []);
  assert.deepEqual(fixture.toasts, []);
});

test("保存缩放偏好失败时保留当前比例并显示错误", async () => {
  const fixture = createFixture({
    storageSet: async () => {
      throw new Error("存储不可用");
    },
  });
  fixture.binding.initialize(100);

  fixture.wheel({ ctrlKey: true, deltaY: -1 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.binding.zoom, 110);
  assert.equal(fixture.root.style.zoom, "1.1");
  assert.deepEqual(fixture.toasts, ["侧栏缩放 110%", "存储不可用"]);
});

test("初始化不会覆盖读取期间发生的滚轮缩放", async () => {
  const fixture = createFixture();

  fixture.wheel({ ctrlKey: true, deltaY: -1 });
  fixture.binding.initialize(90);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.binding.zoom, 110);
  assert.equal(fixture.root.style.zoom, "1.1");
  assert.deepEqual(fixture.saves, [{ sidepanelZoom: 110 }]);
});
