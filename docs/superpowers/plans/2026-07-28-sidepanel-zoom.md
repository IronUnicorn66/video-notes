# 侧栏整体缩放实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过 Ctrl/Command + 滚轮缩放整个 Edge 扩展侧栏，并在重新打开侧栏后恢复上次比例。

**Architecture:** 新增一个无页面全局依赖的缩放绑定模块，集中处理比例校验、滚轮事件、根节点样式、持久化和提示。`sidepanel.js` 只注入 `window`、文档根节点、`chrome.storage` 与现有提示函数，并复用当前启动和存储同步流程。

**Tech Stack:** 原生 JavaScript ES modules、Chrome Extension Side Panel API、`chrome.storage.local`、CSS `zoom`、Node.js `node:test`

## Global Constraints

- 默认比例 100%，范围 75%～200%，单次步进 10%。
- 仅 Ctrl + 滚轮或 Command + 滚轮触发缩放；普通滚轮保留原滚动行为。
- 比例变化时显示“侧栏缩放 N%”，不增加常驻控件。
- 比例存入 `chrome.storage.local` 的 `sidepanelZoom` 字段。
- 仅修改与缩放直接相关的文件，不调整现有视觉样式或笔记行为。
- Markdown 代码块必须带代码语言和 `{.line-numbers}`。

---

### Task 1: 缩放计算与界面绑定

**Files:**
- Create: `src/core/sidepanel-zoom.js`
- Create: `tests/sidepanel-zoom.test.js`

**Interfaces:**
- Consumes: 带 `addEventListener` 的事件目标、带 `style.zoom` 的根节点、形如 `chrome.storage` 的存储对象、`showToast(message)` 回调。
- Produces: `normalizeSidepanelZoom(value): number`、`sidepanelZoomAfterWheel(currentZoom, deltaY): number`、`createSidepanelZoomBinding(options): { zoom, initialize, sync }`。

- [ ] **Step 1: 写比例校验和步进的失败测试**

```javascript {.line-numbers}
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
```

- [ ] **Step 2: 运行测试并确认失败原因是模块缺失**

Run: `node --test tests/sidepanel-zoom.test.js`

Expected: FAIL，提示无法导入 `src/core/sidepanel-zoom.js`。

- [ ] **Step 3: 实现最小比例计算**

```javascript {.line-numbers}
const DEFAULT_ZOOM = 100;
const MIN_ZOOM = 75;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

export function normalizeSidepanelZoom(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));
}

export function sidepanelZoomAfterWheel(currentZoom, deltaY) {
  const normalized = normalizeSidepanelZoom(currentZoom);
  if (deltaY === 0) return normalized;
  return normalizeSidepanelZoom(normalized + (deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}
```

- [ ] **Step 4: 运行测试并确认比例计算通过**

Run: `node --test tests/sidepanel-zoom.test.js`

Expected: PASS。

- [ ] **Step 5: 写界面绑定的失败测试**

测试夹具提供假事件目标、根节点、存储和提示数组，验证以下真实可观察行为：

```javascript {.line-numbers}
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

test("普通滚轮和边界外滚轮不产生多余副作用", async () => {
  const fixture = createFixture();
  fixture.binding.initialize(200);

  const plainEvent = fixture.wheel({ deltaY: 1 });
  const boundaryEvent = fixture.wheel({ ctrlKey: true, deltaY: -1 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(plainEvent.defaultPrevented, false);
  assert.equal(boundaryEvent.defaultPrevented, true);
  assert.deepEqual(fixture.saves, []);
  assert.deepEqual(fixture.toasts, []);
});
```

- [ ] **Step 6: 运行测试并确认失败原因是绑定接口缺失**

Run: `node --test tests/sidepanel-zoom.test.js`

Expected: FAIL，提示 `createSidepanelZoomBinding` 未定义或无法调用。

- [ ] **Step 7: 实现最小界面绑定**

```javascript {.line-numbers}
export function createSidepanelZoomBinding({ target, root, storage, showToast }) {
  let zoom = DEFAULT_ZOOM;

  function apply(value) {
    zoom = normalizeSidepanelZoom(value);
    root.style.zoom = String(zoom / 100);
    return zoom;
  }

  async function persist(value) {
    try {
      await storage.local.set({ sidepanelZoom: value });
    } catch (error) {
      showToast(error.message);
    }
  }

  target.addEventListener("wheel", (event) => {
    if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
    event.preventDefault();
    const nextZoom = sidepanelZoomAfterWheel(zoom, event.deltaY);
    if (nextZoom === zoom) return;
    apply(nextZoom);
    showToast(`侧栏缩放 ${nextZoom}%`);
    void persist(nextZoom);
  }, { passive: false });

  return {
    get zoom() {
      return zoom;
    },
    initialize: apply,
    sync: apply,
  };
}
```

- [ ] **Step 8: 运行测试并确认模块全部通过**

Run: `node --test tests/sidepanel-zoom.test.js`

Expected: PASS，且没有警告或未处理的 Promise 拒绝。

- [ ] **Step 9: 提交核心模块**

```bash {.line-numbers}
git add src/core/sidepanel-zoom.js tests/sidepanel-zoom.test.js
git commit -m "新增: 实现侧栏滚轮缩放模块"
```

### Task 2: 接入侧栏启动与偏好同步

**Files:**
- Modify: `src/core/sidepanel-note-sort.js`
- Modify: `tests/sidepanel-note-sort.test.js`
- Modify: `src/sidepanel.js`

**Interfaces:**
- Consumes: Task 1 的 `createSidepanelZoomBinding`，以及绑定的 `initialize(value)`、`sync(value)`。
- Produces: 启动时恢复 `sidepanelZoom`，存储变化时同步当前根节点缩放比例。

- [ ] **Step 1: 写启动恢复的失败测试**

在 `initializeSidepanel` 测试中加入缩放绑定记录器，并让存储返回 130：

```javascript {.line-numbers}
const zooms = [];
const sidepanelZoomBinding = {
  initialize(value) { zooms.push(value); },
};

await initializeSidepanel({
  storage: {
    local: {
      get: async () => ({
        shortcutCode: "AltRight",
        noteSortOrder: "newest",
        sidepanelZoom: 130,
      }),
    },
  },
  sidepanelZoomBinding,
  // 保留测试现有的其余依赖。
});

assert.deepEqual(zooms, [130]);
```

同时更新“读取偏好失败”测试，断言缩放绑定收到默认值 100。

- [ ] **Step 2: 运行启动测试并确认失败**

Run: `node --test tests/sidepanel-note-sort.test.js`

Expected: FAIL，`zooms` 仍为空。

- [ ] **Step 3: 扩展启动偏好读取**

在 `initializeSidepanel` 中增加 `sidepanelZoomBinding` 参数，读取默认值 100，并在排序初始化旁调用：

```javascript {.line-numbers}
let sidepanelZoom = 100;
({ shortcutCode = "AltRight", noteSortOrder = "newest", sidepanelZoom = 100 } =
  await storage.local.get({ shortcutCode, noteSortOrder, sidepanelZoom }));

onShortcutCode(shortcutCode);
noteSortBinding.initialize(noteSortOrder);
sidepanelZoomBinding.initialize(sidepanelZoom);
```

- [ ] **Step 4: 运行启动测试并确认通过**

Run: `node --test tests/sidepanel-note-sort.test.js`

Expected: PASS。

- [ ] **Step 5: 接入真实侧栏**

在 `src/sidepanel.js` 中：

```javascript {.line-numbers}
import { createSidepanelZoomBinding } from "./core/sidepanel-zoom.js";

const sidepanelZoomBinding = createSidepanelZoomBinding({
  target: window,
  root: document.documentElement,
  storage: chrome.storage,
  showToast,
});
```

将绑定传入 `initializeSidepanel`，并在 `chrome.storage.onChanged` 中同步外部变化：

```javascript {.line-numbers}
if (area === "local" && changes.sidepanelZoom) {
  sidepanelZoomBinding.sync(changes.sidepanelZoom.newValue);
}
```

- [ ] **Step 6: 运行相关测试与构建**

Run: `node --test tests/sidepanel-zoom.test.js tests/sidepanel-note-sort.test.js`

Expected: PASS。

Run: `npm run build`

Expected: 构建成功，`dist/sidepanel.js` 包含缩放模块且无错误。

- [ ] **Step 7: 提交侧栏接入**

```bash {.line-numbers}
git add src/core/sidepanel-note-sort.js tests/sidepanel-note-sort.test.js src/sidepanel.js
git commit -m "新增: 接入侧栏缩放偏好"
```

### Task 3: 回归与界面验收

**Files:**
- Modify only if verification finds a defect directly caused by Tasks 1–2.

**Interfaces:**
- Consumes: 完成接入的侧栏缩放功能。
- Produces: 可复现的自动化与真实侧栏验收结果。

- [ ] **Step 1: 运行完整测试套件**

Run: `npm test`

Expected: 全部测试通过，无失败、错误或警告。

- [ ] **Step 2: 检查差异范围**

Run: `git diff HEAD~2 --check`

Expected: 无空白错误。

Run: `git diff HEAD~2 -- src/core/sidepanel-zoom.js tests/sidepanel-zoom.test.js src/core/sidepanel-note-sort.js tests/sidepanel-note-sort.test.js src/sidepanel.js`

Expected: 每一处变化都可追溯到缩放、持久化或测试要求。

- [ ] **Step 3: 在 Edge 侧栏执行人工验收**

1. 载入构建后的扩展并打开一个有笔记的视频。
2. 使用普通滚轮，确认侧栏继续上下滚动。
3. 使用 Ctrl/Command + 向上滚轮，确认整个侧栏放大并显示比例。
4. 使用 Ctrl/Command + 向下滚轮，确认整个侧栏缩小并显示比例。
5. 滚动至 75% 和 200% 边界，确认比例不会越界。
6. 关闭并重新打开侧栏，确认恢复关闭前比例。
7. 编辑并保存一条笔记，确认缩放不影响输入、行内编辑与历史操作。

- [ ] **Step 4: 若人工验收发现缺陷，先补失败测试再做最小修复**

Run: `node --test tests/sidepanel-zoom.test.js tests/sidepanel-note-sort.test.js`

Expected: 新测试先因该缺陷失败；修复后相关测试及 `npm test` 全部通过。
