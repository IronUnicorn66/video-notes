# 沉浸式翻译字幕兼容实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让视频笔记读取画面中由沉浸式翻译显示的原文和译文，并继续兼容平台原生字幕。

**Architecture:** 新增一个只负责读取页面字幕文本的核心模块，按“沉浸式翻译、平台原生字幕”的顺序返回首个可见来源。内容脚本继续负责定时采集、时间缓冲和标记快照，只把 DOM 读取委托给新模块。

**Tech Stack:** JavaScript ES modules、Node.js 内置测试运行器、Chrome/Edge Manifest V3。

## Global Constraints

- 同时保留沉浸式翻译的原文和译文，按画面顺序换行保存。
- 同一帧只采集一个字幕来源，避免重复。
- 沉浸式翻译不可用时回退到 YouTube 或哔哩哔哩原生字幕。
- 不改变已有设置、字幕缓冲、笔记数据结构和导出格式。
- 不新增依赖，不扫描播放器中的任意文字。

---

### Task 1: 兼容沉浸式翻译字幕 DOM

**Files:**
- Create: `src/core/subtitle-text.js`
- Create: `tests/subtitle-text.test.js`
- Modify: `src/content.js:4,123-140`

**Interfaces:**
- Consumes: `root.querySelectorAll(selector)`、字幕节点的 `textContent` 与 `getClientRects()`。
- Produces: `readRenderedSubtitleText(root, platform): string`，返回当前可见字幕文本或空字符串。

- [ ] **Step 1: 写入沉浸式翻译双语字幕失败用例**

测试构造一个可见 `.imt-captions-text` 容器，内部包含 `.source-cue` 和 `.target-cue`，并断言返回值保留两行：

```javascript {.line-numbers}
assert.equal(
  readRenderedSubtitleText(root, "youtube"),
  "children starting school this year will be retiring in 2065.\n今年入学的孩子们将在 2065 年退休。",
);
```

同时添加两个行为断言：沉浸式翻译有内容时忽略原生字幕；沉浸式翻译为空或不可见时回退到对应平台原生字幕。

- [ ] **Step 2: 运行定向测试并确认按预期失败**

Run: `node --test tests/subtitle-text.test.js`

Expected: FAIL，原因是 `src/core/subtitle-text.js` 或 `readRenderedSubtitleText` 尚不存在。

- [ ] **Step 3: 实现最小字幕读取模块**

实现以下来源优先级：

```javascript {.line-numbers}
const IMMERSIVE_CONTAINER_SELECTOR = ".imt-captions-text";
const IMMERSIVE_CUE_SELECTOR = ".source-cue, .target-cue";
const NATIVE_SELECTORS = {
  youtube: ".ytp-caption-segment",
  bilibili: ".bpx-player-subtitle-panel-text, .bilibili-player-video-subtitle",
};
```

模块只读取可见节点，清理空白，并在同一来源内去除相邻重复文本。找到非空沉浸式翻译字幕后立即返回；否则读取平台原生选择器。

- [ ] **Step 4: 接入内容脚本**

在 `src/content.js` 导入 `readRenderedSubtitleText`，删除文件内的 `renderedSubtitleText`，并把采集调用改为：

```javascript {.line-numbers}
subtitleCapture.add(
  media.currentTime,
  readRenderedSubtitleText(document, context.platform),
);
```

- [ ] **Step 5: 运行定向测试和完整测试**

Run: `node --test tests/subtitle-text.test.js`

Expected: PASS。

Run: `npm test`

Expected: 全部测试通过，无错误和警告。

- [ ] **Step 6: 构建并检查扩展包**

Run: `npm run build && npm run package`

Expected: 构建和打包成功，`dist` 包含更新后的内容脚本。

- [ ] **Step 7: 提交修复**

```bash {.line-numbers}
git add src/core/subtitle-text.js tests/subtitle-text.test.js src/content.js docs/superpowers/plans/2026-07-27-immersive-translate-subtitle.md
git commit -m "修复: 兼容沉浸式翻译双语字幕"
```

- [ ] **Step 8: Edge 实机验收**

在 Edge 扩展页重新加载 worktree 的 `dist`，刷新带沉浸式翻译双语字幕的 YouTube 页面，等待字幕显示超过一个采样周期后创建标记。确认独立字幕块同时包含原文和译文，并切换前置字幕开关验证关闭后新标记不再显示字幕块。
