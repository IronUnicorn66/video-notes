# Configurable Subtitle Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侧栏中展示并独立编辑笔记的前置字幕，同时提供默认开启的 5、10、20、30 秒固定采集范围设置。

**Architecture:** 新增纯逻辑字幕采集控制器，统一设置默认值、合法范围、关闭时清空缓冲和按窗口截取；内容脚本只负责把浏览器存储变更和页面字幕交给控制器。字幕字段更新与侧栏展示状态分别由小型纯函数承载，后台和侧栏保留现有消息及渲染结构，只增加必要接线。

**Tech Stack:** JavaScript ES modules、Chrome/Edge Manifest V3、IndexedDB、`chrome.storage.local`、Node.js 22 `node:test`、esbuild。

## Global Constraints

- 目标环境保持桌面 Microsoft Edge 150。
- 字幕默认开启，默认范围为 20 秒。
- 合法范围只有 5、10、20、30 秒。
- 关闭设置后停止新字幕采集并隐藏字幕块，已经保存的字幕不得删除。
- 字幕只读取播放器已经渲染的内容，不接入站点字幕接口。
- 字幕编辑不得增加 `userEditVersion`。
- 不新增运行时或开发依赖。
- 所有提交消息使用简体中文，格式为 `<类型>: <简短描述>`。

---

## File Structure

- Create `src/core/subtitle-capture.js`：归一化字幕设置，控制采集开关、缓冲清理和截取窗口。
- Modify `src/core/subtitle-buffer.js`：增加供页面切换和关闭采集使用的 `clear()`。
- Create `tests/subtitle-capture.test.js`：覆盖默认值、固定范围、非法值、关闭清理和重新开启。
- Modify `src/content.js`：把现有 `SubtitleBuffer` 直连改为 `SubtitleCapture`，接入浏览器设置。
- Create `src/core/note-editing.js`：提供字幕字段更新的纯函数。
- Create `tests/note-editing.test.js`：验证字幕修订不会影响正文编辑版本。
- Modify `src/background.js`：增加 `UPDATE_NOTE_SUBTITLE` 消息接线。
- Create `src/core/subtitle-view.js`：把字幕字段和全局开关转换为侧栏展示状态。
- Create `tests/subtitle-view.test.js`：覆盖隐藏、有内容和空内容三种展示状态。
- Modify `src/sidepanel.html`：增加字幕开关和固定范围下拉框。
- Modify `src/sidepanel.js`：加载和保存设置，渲染及编辑独立字幕块。
- Modify `src/sidepanel.css`：增加字幕设置和字幕块样式。
- Modify `README.md`：说明可配置字幕范围及关闭行为。
- Modify `docs/ACCEPTANCE.md`：补充 Edge 150 人工验收步骤。

### Task 1: 字幕设置与采集控制

**Files:**

- Create: `src/core/subtitle-capture.js`
- Modify: `src/core/subtitle-buffer.js`
- Create: `tests/subtitle-capture.test.js`
- Modify: `src/content.js`

**Interfaces:**

- Produces: `SUBTITLE_WINDOW_OPTIONS: readonly number[]`
- Produces: `normalizeSubtitleSettings(values): { enabled: boolean, windowSeconds: number }`
- Produces: `SubtitleCapture.updateSettings(values)`
- Produces: `SubtitleCapture.add(seconds, text)`
- Produces: `SubtitleCapture.before(markerSeconds): string`
- Produces: `SubtitleCapture.clear()`

- [ ] **Step 1: 写入设置归一化失败测试**

创建 `tests/subtitle-capture.test.js`，先覆盖默认值、四个合法值和非法值回退。能使测试失败的生产变更包括错误默认值、接受任意整数或遗漏合法选项。

```javascript {.line-numbers}
import assert from "node:assert/strict";
import test from "node:test";

import {
  SUBTITLE_WINDOW_OPTIONS,
  normalizeSubtitleSettings,
} from "../src/core/subtitle-capture.js";

test("字幕设置默认开启并使用 20 秒固定范围", () => {
  assert.deepEqual(normalizeSubtitleSettings({}), {
    enabled: true,
    windowSeconds: 20,
  });
  assert.deepEqual(SUBTITLE_WINDOW_OPTIONS, [5, 10, 20, 30]);
});

test("字幕设置只接受四个固定范围", () => {
  for (const windowSeconds of [5, 10, 20, 30]) {
    assert.deepEqual(normalizeSubtitleSettings({
      subtitleEnabled: false,
      subtitleWindowSeconds: windowSeconds,
    }), {
      enabled: false,
      windowSeconds,
    });
  }

  for (const subtitleWindowSeconds of [0, 15, 31, "20", null]) {
    assert.equal(
      normalizeSubtitleSettings({ subtitleWindowSeconds }).windowSeconds,
      20,
    );
  }
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失失败**

```bash {.line-numbers}
node --test tests/subtitle-capture.test.js
```

Expected: FAIL，错误指出 `src/core/subtitle-capture.js` 不存在。

- [ ] **Step 3: 实现最小设置归一化**

创建 `src/core/subtitle-capture.js` 的设置部分：

```javascript {.line-numbers}
export const SUBTITLE_WINDOW_OPTIONS = Object.freeze([5, 10, 20, 30]);

export function normalizeSubtitleSettings(values = {}) {
  const windowSeconds = Number.isInteger(values.subtitleWindowSeconds)
    && SUBTITLE_WINDOW_OPTIONS.includes(values.subtitleWindowSeconds)
    ? values.subtitleWindowSeconds
    : 20;
  return {
    enabled: typeof values.subtitleEnabled === "boolean"
      ? values.subtitleEnabled
      : true,
    windowSeconds,
  };
}
```

- [ ] **Step 4: 运行设置测试并确认通过**

```bash {.line-numbers}
node --test tests/subtitle-capture.test.js
```

Expected: PASS 2，FAIL 0。

- [ ] **Step 5: 写入窗口截取和关闭清理失败测试**

先把测试文件的导入改为：

```javascript {.line-numbers}
import {
  SUBTITLE_WINDOW_OPTIONS,
  SubtitleCapture,
  normalizeSubtitleSettings,
} from "../src/core/subtitle-capture.js";
```

再追加以下测试。手工推导的期望值分别验证 5、10、20、30 秒边界；第二个测试会捕获关闭后仍保留旧缓冲或仍继续采集的错误。

```javascript {.line-numbers}
test("字幕采集按当前固定范围截取标记前内容", () => {
  const expected = new Map([
    [5, "最近"],
    [10, "较近\n最近"],
    [20, "中段\n较近\n最近"],
    [30, "较远\n中段\n较近\n最近"],
  ]);

  for (const [windowSeconds, text] of expected) {
    const capture = new SubtitleCapture({
      subtitleEnabled: true,
      subtitleWindowSeconds: windowSeconds,
    });
    capture.add(9, "范围外");
    capture.add(19, "较远");
    capture.add(29, "中段");
    capture.add(34, "较近");
    capture.add(36, "最近");

    assert.equal(capture.before(40), text);
  }
});

test("关闭字幕会清空未保存缓冲并忽略关闭期间内容", () => {
  const capture = new SubtitleCapture();
  capture.add(10, "关闭前");

  capture.updateSettings({ subtitleEnabled: false });
  capture.add(11, "关闭期间");
  assert.equal(capture.before(12), "");

  capture.updateSettings({ subtitleEnabled: true });
  capture.add(12, "重新开启");
  assert.equal(capture.before(13), "重新开启");
});
```

- [ ] **Step 6: 运行测试并确认因控制器缺失失败**

```bash {.line-numbers}
node --test tests/subtitle-capture.test.js
```

Expected: FAIL，错误指出 `SubtitleCapture` 不是构造函数或未导出。

- [ ] **Step 7: 实现控制器和缓冲清理**

在 `SubtitleBuffer` 中增加：

```javascript {.line-numbers}
clear() {
  this.items = [];
}
```

在 `src/core/subtitle-capture.js` 顶部增加导入，再追加控制器：

```javascript {.line-numbers}
import { SubtitleBuffer } from "./subtitle-buffer.js";

export class SubtitleCapture {
  constructor(values = {}) {
    const settings = normalizeSubtitleSettings(values);
    this.enabled = settings.enabled;
    this.windowSeconds = settings.windowSeconds;
    this.buffer = new SubtitleBuffer({ retentionSeconds: 60 });
  }

  updateSettings(values = {}) {
    const settings = normalizeSubtitleSettings({
      subtitleEnabled: Object.hasOwn(values, "subtitleEnabled")
        ? values.subtitleEnabled
        : this.enabled,
      subtitleWindowSeconds: Object.hasOwn(values, "subtitleWindowSeconds")
        ? values.subtitleWindowSeconds
        : this.windowSeconds,
    });
    if (this.enabled && !settings.enabled) this.buffer.clear();
    this.enabled = settings.enabled;
    this.windowSeconds = settings.windowSeconds;
  }

  add(seconds, text) {
    if (this.enabled) this.buffer.add(seconds, text);
  }

  before(markerSeconds) {
    return this.enabled
      ? this.buffer.before(markerSeconds, {
          seconds: this.windowSeconds,
          maxChars: 500,
        })
      : "";
  }

  clear() {
    this.buffer.clear();
  }
}
```

- [ ] **Step 8: 运行采集测试并确认通过**

```bash {.line-numbers}
node --test tests/subtitle-capture.test.js tests/subtitle-buffer.test.js
```

Expected: PASS 7，FAIL 0。

- [ ] **Step 9: 把内容脚本接到采集控制器**

在 `src/content.js` 中用 `SubtitleCapture` 替换直接使用的 `SubtitleBuffer`：

```javascript {.line-numbers}
import { SubtitleCapture } from "./core/subtitle-capture.js";

const subtitleCapture = new SubtitleCapture({ subtitleEnabled: false });
```

内容脚本在本地设置读取完成前暂不采集，避免已经关闭字幕的用户在页面初始化竞态中短暂读取字幕。缺失设置仍会由随后读取的默认值切换为开启。

将采集、标记快照和页面切换分别改为：

```javascript {.line-numbers}
subtitleCapture.add(media.currentTime, renderedSubtitleText(context));
subtitleContext: subtitleCapture.before(seconds),
subtitleCapture.clear();
```

在启动阶段读取设置，并在现有 `chrome.storage.onChanged` 监听器中传入变化：

```javascript {.line-numbers}
chrome.storage.local.get({
  subtitleEnabled: true,
  subtitleWindowSeconds: 20,
}).then((settings) => subtitleCapture.updateSettings(settings));

if (area === "local" && (
  changes.subtitleEnabled
  || changes.subtitleWindowSeconds
)) {
  subtitleCapture.updateSettings({
    ...(changes.subtitleEnabled
      ? { subtitleEnabled: changes.subtitleEnabled.newValue }
      : {}),
    ...(changes.subtitleWindowSeconds
      ? { subtitleWindowSeconds: changes.subtitleWindowSeconds.newValue }
      : {}),
  });
}
```

- [ ] **Step 10: 验证内容脚本构建和相关测试**

```bash {.line-numbers}
npm run build
node --test tests/subtitle-capture.test.js tests/subtitle-buffer.test.js tests/manifest.test.js
```

Expected: 构建成功，相关测试全部通过且没有警告。

- [ ] **Step 11: 提交字幕采集改动**

```bash {.line-numbers}
git add src/core/subtitle-capture.js src/core/subtitle-buffer.js src/content.js tests/subtitle-capture.test.js
git commit -m "新增: 支持配置前置字幕采集范围"
```

### Task 2: 独立更新字幕字段

**Files:**

- Create: `src/core/note-editing.js`
- Create: `tests/note-editing.test.js`
- Modify: `src/background.js`

**Interfaces:**

- Produces: `applySubtitleEdit(note, value, updatedAt): NoteEntry`
- Consumes: `VideoNotesRepository.updateNote(id, updater)`
- Produces: 后台消息 `UPDATE_NOTE_SUBTITLE`，输入 `{ noteId, subtitleContext }`，输出 `{ note }`

- [ ] **Step 1: 写入字幕字段更新失败测试**

创建 `tests/note-editing.test.js`。该测试会捕获错误修改 `body`、增加 `userEditVersion`、未清理首尾空白或遗漏更新时间的实现。

```javascript {.line-numbers}
import assert from "node:assert/strict";
import test from "node:test";

import { applySubtitleEdit } from "../src/core/note-editing.js";

test("字幕编辑只更新字幕内容和更新时间", () => {
  const original = {
    id: "note-1",
    body: "个人正文",
    subtitleContext: "原字幕",
    userEditVersion: 3,
    updatedAt: 100,
  };

  assert.deepEqual(applySubtitleEdit(original, "  修订字幕  ", 200), {
    id: "note-1",
    body: "个人正文",
    subtitleContext: "修订字幕",
    userEditVersion: 3,
    updatedAt: 200,
  });
  assert.equal(original.subtitleContext, "原字幕");
});

test("字幕编辑允许清空内容", () => {
  const updated = applySubtitleEdit({
    id: "note-1",
    subtitleContext: "原字幕",
    userEditVersion: 1,
  }, "   ", 300);

  assert.equal(updated.subtitleContext, "");
  assert.equal(updated.userEditVersion, 1);
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失失败**

```bash {.line-numbers}
node --test tests/note-editing.test.js
```

Expected: FAIL，错误指出 `src/core/note-editing.js` 不存在。

- [ ] **Step 3: 实现字幕字段纯更新函数**

创建 `src/core/note-editing.js`：

```javascript {.line-numbers}
export function applySubtitleEdit(note, value, updatedAt = Date.now()) {
  return {
    ...note,
    subtitleContext: String(value ?? "").trim(),
    updatedAt,
  };
}
```

- [ ] **Step 4: 运行测试并确认通过**

```bash {.line-numbers}
node --test tests/note-editing.test.js
```

Expected: PASS 2，FAIL 0。

- [ ] **Step 5: 接入后台消息**

在 `src/background.js` 导入 `applySubtitleEdit`，并紧跟 `UPDATE_NOTE_BODY` 分支增加：

```javascript {.line-numbers}
case "UPDATE_NOTE_SUBTITLE": {
  const note = await repository.updateNote(message.noteId, (current) => (
    applySubtitleEdit(current, message.subtitleContext)
  ));
  return { note };
}
```

- [ ] **Step 6: 验证后台构建和回归测试**

```bash {.line-numbers}
npm run build
node --test tests/note-editing.test.js tests/storage.test.js tests/manifest.test.js
```

Expected: 构建成功，相关测试全部通过。

- [ ] **Step 7: 提交字幕保存改动**

```bash {.line-numbers}
git add src/core/note-editing.js src/background.js tests/note-editing.test.js
git commit -m "新增: 支持独立保存前置字幕"
```

### Task 3: 侧栏设置与独立字幕块

**Files:**

- Create: `src/core/subtitle-view.js`
- Create: `tests/subtitle-view.test.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `src/sidepanel.css`

**Interfaces:**

- Consumes: `normalizeSubtitleSettings(values)`
- Produces: `subtitleBlockState(note, enabled): { visible, empty, text }`
- Consumes: 后台消息 `UPDATE_NOTE_SUBTITLE`
- Consumes and writes: `chrome.storage.local.subtitleEnabled`
- Consumes and writes: `chrome.storage.local.subtitleWindowSeconds`

- [ ] **Step 1: 写入字幕展示状态失败测试**

创建 `tests/subtitle-view.test.js`。测试会捕获关闭时仍显示、空值提示分支错误和未清理展示文本首尾空白。

```javascript {.line-numbers}
import assert from "node:assert/strict";
import test from "node:test";

import { subtitleBlockState } from "../src/core/subtitle-view.js";

test("关闭设置时隐藏字幕块并保留笔记数据", () => {
  const note = { subtitleContext: "历史字幕" };
  assert.deepEqual(subtitleBlockState(note, false), {
    visible: false,
    empty: false,
    text: "历史字幕",
  });
  assert.equal(note.subtitleContext, "历史字幕");
});

test("开启设置时区分已有字幕和空字幕", () => {
  assert.deepEqual(subtitleBlockState({ subtitleContext: "  老师原话  " }, true), {
    visible: true,
    empty: false,
    text: "老师原话",
  });
  assert.deepEqual(subtitleBlockState({}, true), {
    visible: true,
    empty: true,
    text: "",
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失失败**

```bash {.line-numbers}
node --test tests/subtitle-view.test.js
```

Expected: FAIL，错误指出 `src/core/subtitle-view.js` 不存在。

- [ ] **Step 3: 实现字幕展示状态**

创建 `src/core/subtitle-view.js`：

```javascript {.line-numbers}
export function subtitleBlockState(note, enabled) {
  const text = String(note?.subtitleContext ?? "").trim();
  return {
    visible: enabled === true,
    empty: text.length === 0,
    text,
  };
}
```

- [ ] **Step 4: 运行展示状态测试并确认通过**

```bash {.line-numbers}
node --test tests/subtitle-view.test.js
```

Expected: PASS 2，FAIL 0。

- [ ] **Step 5: 增加侧栏设置控件**

在 `src/sidepanel.html` 的设置内容中增加一行，固定选项直接写入 HTML：

```html {.line-numbers}
<div class="setting-row">
  <div class="subtitle-setting">
    <label for="subtitle-enabled">
      <input id="subtitle-enabled" type="checkbox" checked />
      <strong>前置字幕</strong>
    </label>
    <p>读取播放器已经显示的字幕，并附在新标记中。</p>
    <label for="subtitle-window-seconds">读取标记前</label>
    <select id="subtitle-window-seconds">
      <option value="5">5 秒</option>
      <option value="10">10 秒</option>
      <option value="20" selected>20 秒</option>
      <option value="30">30 秒</option>
    </select>
  </div>
</div>
```

- [ ] **Step 6: 加载、保存和响应字幕设置**

在 `src/sidepanel.js` 导入 `normalizeSubtitleSettings` 与 `subtitleBlockState`，在 `elements` 中注册两个控件：

```javascript {.line-numbers}
import { normalizeSubtitleSettings } from "./core/subtitle-capture.js";
import { subtitleBlockState } from "./core/subtitle-view.js";

const elements = {
  // 保留现有元素。
  subtitleEnabled: document.querySelector("#subtitle-enabled"),
  subtitleWindowSeconds: document.querySelector("#subtitle-window-seconds"),
};
```

在现有运行状态旁维护：

```javascript {.line-numbers}
let subtitleSettings = normalizeSubtitleSettings();
```

在底部初始化流程进入 `refresh()` 前读取并同步控件：

```javascript {.line-numbers}
subtitleSettings = normalizeSubtitleSettings(
  await chrome.storage.local.get({
    subtitleEnabled: true,
    subtitleWindowSeconds: 20,
  }),
);
elements.subtitleEnabled.checked = subtitleSettings.enabled;
elements.subtitleWindowSeconds.value = String(subtitleSettings.windowSeconds);
elements.subtitleWindowSeconds.disabled = !subtitleSettings.enabled;
```

复选框变化时保存开关；保存失败时恢复上一次有效界面：

```javascript {.line-numbers}
elements.subtitleEnabled.addEventListener("change", async () => {
  const previous = subtitleSettings;
  elements.subtitleWindowSeconds.disabled = !elements.subtitleEnabled.checked;
  try {
    await chrome.storage.local.set({
      subtitleEnabled: elements.subtitleEnabled.checked,
    });
  } catch (error) {
    elements.subtitleEnabled.checked = previous.enabled;
    elements.subtitleWindowSeconds.disabled = !previous.enabled;
    showToast(error.message);
  }
});
```

下拉框变化时保存数值；失败时恢复上一次固定值：

```javascript {.line-numbers}
elements.subtitleWindowSeconds.addEventListener("change", async () => {
  const previous = subtitleSettings;
  try {
    await chrome.storage.local.set({
      subtitleWindowSeconds: Number(elements.subtitleWindowSeconds.value),
    });
  } catch (error) {
    elements.subtitleWindowSeconds.value = String(previous.windowSeconds);
    showToast(error.message);
  }
});
```

在现有 `chrome.storage.onChanged` 监听器中合并变化、重新归一化设置、同步控件并刷新时间线：

```javascript {.line-numbers}
if (area === "local" && (
  changes.subtitleEnabled
  || changes.subtitleWindowSeconds
)) {
  subtitleSettings = normalizeSubtitleSettings({
    subtitleEnabled: changes.subtitleEnabled
      ? changes.subtitleEnabled.newValue
      : subtitleSettings.enabled,
    subtitleWindowSeconds: changes.subtitleWindowSeconds
      ? changes.subtitleWindowSeconds.newValue
      : subtitleSettings.windowSeconds,
  });
  elements.subtitleEnabled.checked = subtitleSettings.enabled;
  elements.subtitleWindowSeconds.value = String(subtitleSettings.windowSeconds);
  elements.subtitleWindowSeconds.disabled = !subtitleSettings.enabled;
  void refresh();
}
```

- [ ] **Step 7: 在笔记卡片中渲染和编辑独立字幕块**

在 `renderNotes()` 的媒体容器之后读取：

```javascript {.line-numbers}
const subtitleState = subtitleBlockState(note, subtitleSettings.enabled);
```

`visible` 为真时紧跟媒体容器追加独立字幕块：

```javascript {.line-numbers}
if (subtitleState.visible) {
  const subtitleBlock = document.createElement("section");
  subtitleBlock.className = "note-subtitle";
  const subtitleHeader = document.createElement("div");
  subtitleHeader.className = "note-subtitle-header";
  const subtitleTitle = document.createElement("strong");
  subtitleTitle.textContent = "前置字幕";
  const subtitleEdit = document.createElement("button");
  subtitleEdit.className = "note-edit-button";
  subtitleEdit.type = "button";
  subtitleEdit.textContent = "编辑字幕";
  const subtitle = document.createElement("p");
  subtitle.className = "note-subtitle-text";
  subtitle.classList.toggle("is-empty", subtitleState.empty);
  subtitle.textContent = subtitleState.empty
    ? "未读取到字幕，请确认播放器已开启字幕"
    : subtitleState.text;
  subtitleHeader.append(subtitleTitle, subtitleEdit);
  subtitleBlock.append(subtitleHeader, subtitle);
  item.append(subtitleBlock);

  subtitleEdit.addEventListener("click", () => {
    let canceled = false;
    editingNoteId = note.id;
    subtitleEdit.disabled = true;
    subtitle.textContent = note.subtitleContext ?? "";
    subtitle.contentEditable = "true";
    subtitle.classList.remove("is-empty");
    subtitle.classList.add("is-editing");
    subtitle.focus();
    let keyHandler;
    const finish = async () => {
      subtitle.removeEventListener("keydown", keyHandler);
      subtitle.contentEditable = "false";
      subtitle.classList.remove("is-editing");
      subtitleEdit.disabled = false;
      editingNoteId = null;
      if (canceled) {
        const restored = subtitleBlockState(note, true);
        subtitle.textContent = restored.empty
          ? "未读取到字幕，请确认播放器已开启字幕"
          : restored.text;
        subtitle.classList.toggle("is-empty", restored.empty);
      } else {
        try {
          const response = await request({
            type: "UPDATE_NOTE_SUBTITLE",
            noteId: note.id,
            subtitleContext: subtitle.textContent,
          });
          note.subtitleContext = response.note.subtitleContext;
          const savedState = subtitleBlockState(note, true);
          subtitle.textContent = savedState.empty
            ? "未读取到字幕，请确认播放器已开启字幕"
            : savedState.text;
          subtitle.classList.toggle("is-empty", savedState.empty);
        } catch (error) {
          showToast(error.message);
        }
      }
      if (refreshAfterEdit) {
        refreshAfterEdit = false;
        void sidePanelRefresh.flushDeferredRefresh();
      }
    };
    subtitle.addEventListener("blur", () => void finish(), { once: true });
    keyHandler = (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        canceled = true;
        subtitle.blur();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        subtitle.blur();
      }
    };
    subtitle.addEventListener("keydown", keyHandler);
  });
}
```

字幕编辑按钮只控制字幕块，正文“编辑”按钮保持现有语义。

- [ ] **Step 8: 增加字幕块和设置样式**

在 `src/sidepanel.css` 中增加：

```css {.line-numbers}
.subtitle-setting {
  width: 100%;
}

.subtitle-setting > label {
  display: flex;
  align-items: center;
  gap: 7px;
}

.subtitle-setting > label[for="subtitle-window-seconds"] {
  margin-top: 9px;
  color: #5f5b51;
  font-size: 11px;
  font-weight: 650;
}

.subtitle-setting select {
  width: 100%;
  margin-top: 5px;
  border: 1px solid #d5d1c7;
  border-radius: 8px;
  padding: 6px 8px;
  color: #34463e;
  background: #fff;
  font-size: 12px;
}

.note-subtitle {
  margin-top: 9px;
  border: 1px solid #dedbd2;
  border-radius: 8px;
  padding: 8px 9px;
  background: #f8f7f2;
}

.note-subtitle-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #5f5b51;
  font-size: 11px;
}

.note-subtitle-text {
  margin: 6px 0 0;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.5;
}

.note-subtitle-text.is-empty {
  color: #858174;
}

.note-subtitle-text.is-editing {
  min-height: 54px;
  border: 1px solid #607c6f;
  border-radius: 8px;
  padding: 7px 8px;
  outline: 0;
  color: #20262f;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(96, 124, 111, 0.12);
}
```

- [ ] **Step 9: 运行侧栏相关测试和构建**

```bash {.line-numbers}
npm run build
node --test tests/subtitle-view.test.js tests/subtitle-capture.test.js tests/note-editing.test.js tests/note-format.test.js tests/sidepanel-scope.test.js tests/manifest.test.js
```

Expected: 构建成功，相关测试全部通过且没有浏览器目标语法错误。

- [ ] **Step 10: 提交侧栏交互改动**

```bash {.line-numbers}
git add src/core/subtitle-view.js src/sidepanel.html src/sidepanel.js src/sidepanel.css tests/subtitle-view.test.js
git commit -m "新增: 在侧栏展示并编辑前置字幕"
```

### Task 4: 文档与整体验证

**Files:**

- Modify: `README.md`
- Modify: `docs/ACCEPTANCE.md`

**Interfaces:**

- Consumes: 已完成的字幕开关、四个固定范围和独立编辑交互。
- Produces: 用户安装说明及 Edge 150 人工验收清单。

- [ ] **Step 1: 更新使用说明**

在 `README.md` 的已实现范围、使用流程和当前边界中明确：

- 默认读取标记前 20 秒已经渲染的字幕。
- 用户可以选择 5、10、20、30 秒。
- 关闭后停止新采集并隐藏字幕块，历史字幕继续保留。
- 侧栏字幕块可独立编辑，Markdown 导出使用修订后的内容。

- [ ] **Step 2: 更新人工验收清单**

在 `docs/ACCEPTANCE.md` 的“笔记资产与侧栏”增加设计文档中的七项字幕验收步骤，保持未执行状态。

- [ ] **Step 3: 运行完整自动验证**

```bash {.line-numbers}
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-0.2.0.zip
git diff --check
```

Expected:

- 全部 Node 测试通过，FAIL 0。
- 构建成功。
- 生成 `artifacts/video-notes-edge-0.2.0.zip`。
- ZIP 完整性检查通过。
- `git diff --check` 无输出。

- [ ] **Step 4: 检查变更范围**

```bash {.line-numbers}
git status --short
git diff --stat HEAD~3
git diff HEAD~3 -- src docs README.md tests
```

确认每个改动都能追溯到字幕设置、采集、展示、编辑、测试或说明；不得混入相邻重构。

- [ ] **Step 5: 提交文档**

```bash {.line-numbers}
git add README.md docs/ACCEPTANCE.md
git commit -m "更新: 补充前置字幕使用与验收说明"
```

- [ ] **Step 6: 完成前复验**

从干净工作树重新运行：

```bash {.line-numbers}
npm test
npm run build
git status --short --branch
```

Expected: 全部测试通过、构建成功，工作树只显示分支信息且没有未提交文件。
