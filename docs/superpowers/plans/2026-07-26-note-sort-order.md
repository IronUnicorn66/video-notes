# 侧栏笔记排序实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为侧栏时间线增加单击切换的“正序 / 倒序”分段开关，默认倒序并全局记住用户选择。

**Architecture:** IndexedDB 和导出流程继续保持时间正序。新增一个无副作用的排序核心模块；侧栏读取 `chrome.storage.local` 中的 `noteSortOrder`，用该模块生成显示副本，并通过两个 `aria-pressed` 按钮切换顺序。

**Tech Stack:** Edge Manifest V3、原生 JavaScript ES Module、Chrome Storage API、HTML/CSS、`node:test`。

## Global Constraints

- 首次使用默认“倒序”，即最新笔记在前。
- 排序偏好在所有视频间共享，合法存储值只有 `newest` 和 `oldest`。
- ZIP 和 Markdown 继续按时间正序导出。
- 不修改 IndexedDB 结构、后台脚本、存储仓库和导出模块。
- 所有提交消息使用简体中文，格式为 `<类型>: <简短描述>`。

---

### Task 1: 实现无副作用的显示排序

**Files:**
- Create: `src/core/note-sort-order.js`
- Create: `tests/note-sort-order.test.js`

**Interfaces:**
- Consumes: `NoteEntry[]`，每条笔记包含数值型 `createdAt`。
- Produces: `normalizeNoteSortOrder(value): "newest" | "oldest"`。
- Produces: `sortNotesForDisplay(notes, order): NoteEntry[]`，返回新数组。

- [ ] **Step 1: 写入会因排序模块缺失而失败的测试**

```javascript {.line-numbers}
import assert from "node:assert/strict";
import test from "node:test";

const sorting = await import("../src/core/note-sort-order.js").catch(() => ({}));

test("缺失或未知偏好默认使用倒序", () => {
  assert.equal(typeof sorting.normalizeNoteSortOrder, "function");
  assert.equal(sorting.normalizeNoteSortOrder(undefined), "newest");
  assert.equal(sorting.normalizeNoteSortOrder("unknown"), "newest");
  assert.equal(sorting.normalizeNoteSortOrder("oldest"), "oldest");
});

test("正序和倒序返回对应副本且不修改输入数组", () => {
  assert.equal(typeof sorting.sortNotesForDisplay, "function");
  const notes = [
    { id: "middle", createdAt: 200 },
    { id: "oldest", createdAt: 100 },
    { id: "newest", createdAt: 300 },
  ];

  assert.deepEqual(
    sorting.sortNotesForDisplay(notes, "oldest").map(({ id }) => id),
    ["oldest", "middle", "newest"],
  );
  assert.deepEqual(
    sorting.sortNotesForDisplay(notes, "newest").map(({ id }) => id),
    ["newest", "middle", "oldest"],
  );
  assert.deepEqual(notes.map(({ id }) => id), ["middle", "oldest", "newest"]);
});
```

- [ ] **Step 2: 运行测试并确认失败原因**

Run: `node --test tests/note-sort-order.test.js`

Expected: FAIL，首个断言显示 `normalizeNoteSortOrder` 的实际类型为 `undefined`。

- [ ] **Step 3: 写入最小排序实现**

```javascript {.line-numbers}
export function normalizeNoteSortOrder(value) {
  return value === "oldest" ? "oldest" : "newest";
}

export function sortNotesForDisplay(notes, order) {
  const direction = normalizeNoteSortOrder(order) === "oldest" ? 1 : -1;
  return [...notes].sort((left, right) => (
    direction * (left.createdAt - right.createdAt)
  ));
}
```

- [ ] **Step 4: 运行单元测试并确认通过**

Run: `node --test tests/note-sort-order.test.js`

Expected: 2 tests pass，0 fail。

- [ ] **Step 5: 提交排序核心**

```bash {.line-numbers}
git add src/core/note-sort-order.js tests/note-sort-order.test.js
git commit -m "新增: 实现侧栏笔记显示排序"
```

### Task 2: 接入正序与倒序分段开关

**Files:**
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.css`
- Modify: `src/sidepanel.js`
- Modify: `tests/manifest.test.js`

**Interfaces:**
- Consumes: `normalizeNoteSortOrder(value)` 和 `sortNotesForDisplay(notes, order)`。
- Persists: `chrome.storage.local.noteSortOrder`，值为 `newest` 或 `oldest`。
- UI contract: `[data-note-sort-order="oldest"]` 表示正序；`[data-note-sort-order="newest"]` 表示倒序。

- [ ] **Step 1: 添加侧栏分段开关契约测试**

在 `tests/manifest.test.js` 增加：

```javascript {.line-numbers}
test("侧栏提供单击切换的正序倒序分段开关", async () => {
  const html = await readFile(new URL("../src/sidepanel.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");

  assert.match(html, /role="group" aria-label="笔记显示顺序"/);
  assert.match(html, /data-note-sort-order="oldest"[^>]*>\s*正序\s*</);
  assert.match(html, /data-note-sort-order="newest"[^>]*>\s*倒序\s*</);
  assert.match(html, /aria-pressed=/);
  assert.match(css, /\.note-sort-toggle/);
  assert.match(css, /\.note-sort-button\.is-active/);
  assert.match(source, /noteSortOrder/);
  assert.match(source, /sortNotesForDisplay/);
});
```

- [ ] **Step 2: 运行契约测试并确认失败原因**

Run: `node --test tests/manifest.test.js`

Expected: FAIL，提示侧栏 HTML 中找不到“笔记显示顺序”分组。

- [ ] **Step 3: 在时间线标题区增加分段开关**

将时间线标题行改成：

```html {.line-numbers}
<div class="section-row">
  <h2 id="timeline-title">标记时间线</h2>
  <div class="timeline-actions">
    <div class="note-sort-toggle" role="group" aria-label="笔记显示顺序">
      <button
        class="note-sort-button"
        type="button"
        data-note-sort-order="oldest"
        aria-pressed="false"
        title="最早笔记在前"
      >正序</button>
      <button
        class="note-sort-button is-active"
        type="button"
        data-note-sort-order="newest"
        aria-pressed="true"
        title="最新笔记在前"
      >倒序</button>
    </div>
    <button id="export-button" class="secondary-button" type="button" disabled>导出 ZIP</button>
  </div>
</div>
```

- [ ] **Step 4: 添加紧凑分段开关样式**

在 `src/sidepanel.css` 增加：

```css {.line-numbers}
.timeline-actions,
.note-sort-toggle {
  display: inline-flex;
  align-items: center;
}

.timeline-actions {
  gap: 8px;
}

.note-sort-toggle {
  border: 1px solid #cfcabe;
  border-radius: 8px;
  padding: 2px;
  background: #f1efe8;
}

.note-sort-button {
  border: 0;
  border-radius: 6px;
  padding: 5px 8px;
  color: #777369;
  background: transparent;
  font-size: 11px;
}

.note-sort-button.is-active {
  color: #34463e;
  background: #fffdf8;
  box-shadow: 0 1px 4px rgba(44, 40, 32, 0.12);
}
```

- [ ] **Step 5: 在侧栏中读取、渲染并保存排序偏好**

在 `src/sidepanel.js`：

- 导入两个排序函数。
- 将两个排序按钮收集到 `elements.noteSortButtons`。
- 增加 `noteSortOrder = "newest"` 和 `currentNotes = []`。
- `renderNotes(notes)` 先保存 `currentNotes = notes`，再对已保存笔记调用 `sortNotesForDisplay()`。
- 增加 `renderNoteSortOrder()`，同步按钮的 `aria-pressed` 与 `is-active`。
- 点击按钮时先更新内存和当前列表，再调用 `chrome.storage.local.set({ noteSortOrder })`；保存失败使用现有 toast 提示。
- 初始化时与 `shortcutCode` 一起读取 `noteSortOrder`，规范化后再首次 `refresh()`。
- `chrome.storage.onChanged` 收到外部偏好变化时，只在值实际变化后重排。

核心逻辑采用：

```javascript {.line-numbers}
function renderNoteSortOrder() {
  for (const button of elements.noteSortButtons) {
    const active = button.dataset.noteSortOrder === noteSortOrder;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

for (const button of elements.noteSortButtons) {
  button.addEventListener("click", async () => {
    const nextOrder = normalizeNoteSortOrder(button.dataset.noteSortOrder);
    if (nextOrder === noteSortOrder) return;
    noteSortOrder = nextOrder;
    renderNoteSortOrder();
    renderNotes(currentNotes);
    try {
      await chrome.storage.local.set({ noteSortOrder });
    } catch (error) {
      showToast(`排序偏好保存失败：${error.message}`);
    }
  });
}
```

- [ ] **Step 6: 运行排序、侧栏和完整测试**

Run: `node --test tests/note-sort-order.test.js tests/manifest.test.js`

Expected: 所有目标测试通过。

Run: `npm test`

Expected: 全部测试通过，0 fail。

- [ ] **Step 7: 构建 Edge 扩展**

Run: `npm run build`

Expected: 命令退出码为 0，`dist/sidepanel.html` 包含“正序”和“倒序”按钮。

- [ ] **Step 8: 在 Edge 中完成实机验收**

1. 重新加载 `/Users/psh/codes/video_notes/.worktrees/note-sort-order/dist`。
2. 打开已有多条笔记的 YouTube 视频，确认首次显示倒序且最新笔记位于顶部。
3. 单击“正序”，确认一次点击后最早笔记移动到顶部。
4. 关闭并重开侧栏，确认仍为正序。
5. 单击“倒序”并新增一条文字标记，确认新笔记位于顶部。
6. 导出 ZIP，确认 Markdown 中的笔记仍按时间正序排列。

- [ ] **Step 9: 提交侧栏交互**

```bash {.line-numbers}
git add src/sidepanel.html src/sidepanel.css src/sidepanel.js tests/manifest.test.js
git commit -m "新增: 支持切换侧栏笔记排序"
```
