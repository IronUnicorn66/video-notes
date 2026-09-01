import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidepanelZoom = await import("../src/core/sidepanel-zoom.js").catch(() => ({}));
const {
  createSidepanelZoomBinding,
  normalizeSidepanelZoom,
  sidepanelZoomAfterStep,
} = sidepanelZoom;

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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

class FakeButton {
  constructor() {
    this.disabled = false;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    if (!this.disabled) this.listeners.get("click")?.();
  }
}

function createFixture({ storageSet } = {}) {
  const target = new FakeEventTarget();
  const root = { style: { zoom: "" } };
  const increaseButton = new FakeButton();
  const decreaseButton = new FakeButton();
  const saves = [];
  const toasts = [];
  const binding = createSidepanelZoomBinding({
    target,
    root,
    increaseButton,
    decreaseButton,
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
    increaseButton,
    decreaseButton,
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

test("按钮方向按 10% 调整并停在边界", () => {
  assert.equal(sidepanelZoomAfterStep(100, 1), 110);
  assert.equal(sidepanelZoomAfterStep(100, -1), 90);
  assert.equal(sidepanelZoomAfterStep(200, 1), 200);
  assert.equal(sidepanelZoomAfterStep(75, -1), 75);
  assert.equal(sidepanelZoomAfterStep(120, 0), 120);
});

test("初始化应用保存的缩放比例并同步边界按钮状态", () => {
  const fixture = createFixture();
  fixture.binding.initialize(130);

  assert.equal(fixture.binding.zoom, 130);
  assert.equal(fixture.root.style.zoom, "1.3");
  assert.equal(fixture.increaseButton.disabled, false);
  assert.equal(fixture.decreaseButton.disabled, false);
  assert.deepEqual(fixture.listenerOptions, { passive: false });

  fixture.binding.initialize(200);
  assert.equal(fixture.increaseButton.disabled, true);
  assert.equal(fixture.decreaseButton.disabled, false);
});

test("缩放按钮会调整、保存并提示当前比例", async () => {
  const fixture = createFixture();
  fixture.binding.initialize(100);

  fixture.increaseButton.click();
  assert.equal(fixture.root.style.zoom, "1.1");

  fixture.decreaseButton.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.root.style.zoom, "1");
  assert.deepEqual(fixture.saves, [{ sidepanelZoom: 110 }, { sidepanelZoom: 100 }]);
  assert.deepEqual(fixture.toasts, ["侧栏缩放 110%", "侧栏缩放 100%"]);
});

test("边界按钮禁用且不会产生多余副作用", async () => {
  const fixture = createFixture();
  fixture.binding.initialize(200);

  assert.equal(fixture.increaseButton.disabled, true);
  fixture.increaseButton.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.binding.zoom, 200);
  assert.deepEqual(fixture.saves, []);
  assert.deepEqual(fixture.toasts, []);
});

test("Ctrl 或 Command 加滚轮只拦截原生缩放，普通滚轮保持不变", async () => {
  const fixture = createFixture();
  fixture.binding.initialize(100);

  const plainEvent = fixture.wheel({ deltaY: 1 });
  const ctrlEvent = fixture.wheel({ ctrlKey: true, deltaY: -1 });
  const metaEvent = fixture.wheel({ metaKey: true, deltaY: 1 });
  const pinchEvent = fixture.wheel({ ctrlKey: true, deltaY: 0 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(plainEvent.defaultPrevented, false);
  assert.equal(ctrlEvent.defaultPrevented, true);
  assert.equal(metaEvent.defaultPrevented, true);
  assert.equal(pinchEvent.defaultPrevented, true);
  assert.equal(fixture.binding.zoom, 100);
  assert.equal(fixture.root.style.zoom, "1");
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

  fixture.increaseButton.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.binding.zoom, 110);
  assert.equal(fixture.root.style.zoom, "1.1");
  assert.deepEqual(fixture.toasts, ["侧栏缩放 110%", "存储不可用"]);
});

test("初始化不会覆盖读取期间发生的按钮缩放", async () => {
  const fixture = createFixture();

  fixture.increaseButton.click();
  fixture.binding.initialize(90);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.binding.zoom, 110);
  assert.equal(fixture.root.style.zoom, "1.1");
  assert.deepEqual(fixture.saves, [{ sidepanelZoom: 110 }]);
});

test("顶部缩放按钮位于语言切换左侧并提供双语无障碍文案", async () => {
  const [html, css, i18n] = await Promise.all([
    read("src/sidepanel.html"),
    read("src/sidepanel.css"),
    read("src/core/i18n.js"),
  ]);

  const controls = html.match(/<div class="video-header-controls">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? "";
  assert.match(controls, /class="sidepanel-zoom-controls"/);
  assert.ok(controls.indexOf("sidepanel-zoom-controls") < controls.indexOf("language-switch"));
  assert.ok(controls.indexOf("sidepanel-zoom-increase") < controls.indexOf("sidepanel-zoom-decrease"));
  assert.match(controls, /data-i18n-aria-label="sidepanelZoomControls"/);
  assert.match(controls, /data-i18n-title="increaseSidepanelZoom"/);
  assert.match(controls, /data-i18n-title="decreaseSidepanelZoom"/);
  assert.match(css, /\.video-header-controls[^{]*\{[^}]*display:\s*flex;/s);
  assert.match(css, /\.sidepanel-zoom-button[^{]*\{[^}]*(?:width|inline-size):\s*28px;[^}]*(?:height|block-size):\s*28px;/s);
  assert.match(i18n, /sidepanelZoomControls:\s*"侧栏缩放"/);
  assert.match(i18n, /sidepanelZoomControls:\s*"Side panel zoom"/);
});
