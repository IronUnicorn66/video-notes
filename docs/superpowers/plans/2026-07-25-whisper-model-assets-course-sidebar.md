# Whisper 多模型、笔记资产与课程专属侧栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户缓存并切换三种本地 Whisper 模型、对同一录音重复转写，在侧栏查看截图与录音，并让侧栏只随受支持的课程标签显示和切换。

**Architecture:** 用只读模型目录驱动下载、缓存和转写器加载，所有任务在入队时固定模型 ID；笔记以追加式转写历史保存模型对比。侧栏直接读取 IndexedDB Blob 并管理对象 URL；后台通过 tab-specific `sidePanel.setOptions()` 控制课程标签范围。

**Tech Stack:** Edge Manifest V3、原生 JavaScript ES Module、`node:test`、IndexedDB、Cache Storage、`@transcribe/shout`、`@transcribe/transcriber`、Side Panel API、esbuild。

## Global Constraints

- 首版验证环境保持 Edge 150、Apple Silicon、16GB 内存。
- 模型固定为 `base-q5_1`、`small-q5_1`、`medium-q5_0`，远程只下载固定版本的权重文件。
- 已下载模型全部保留；本期不提供删除入口。
- 同一时刻只保留一个已加载的 Whisper 实例。录音、转写或下载期间禁止切换模型。
- 用户正文始终优先；重复转写不得覆盖已经编辑的正文。
- 截图和音频继续存放在 IndexedDB；侧栏只创建临时对象 URL。
- 普通标签禁用侧栏；受支持课程标签自动启用并展示对应视频会话。
- 每项实现先写失败测试，再写最小实现，最后运行完整测试。
- 每个提交只包含当前任务，提交消息使用简体中文 `<类型>: <简短描述>`。

## File Structure

- Modify: `src/core/model-config.js` — 三种模型的唯一元数据目录。
- Create: `src/core/model-download.js` — 按模型隔离缓存、分块下载和校验。
- Modify: `src/core/whisper-state.js` — 模型切换约束和追加式转写历史。
- Create: `src/core/transcriber-manager.js` — 单实例 Whisper 装载和销毁。
- Create: `src/core/asset-url-registry.js` — 侧栏 Blob 对象 URL 生命周期。
- Create: `src/core/sidepanel-scope.js` — 从标签 URL 计算侧栏启用状态。
- Modify: `src/offscreen.js` — 选择模型、单实例装载、重复转写。
- Modify: `src/background.js` — 模型消息、任务入队和逐标签侧栏配置。
- Modify: `src/sidepanel.html` — 模型设置、资产区和图片预览对话框。
- Modify: `src/sidepanel.css` — 模型状态、缩略图、音频和预览样式。
- Modify: `src/sidepanel.js` — 模型交互、资产读取、重复转写按钮。
- Modify: `tests/model-config.test.js` — 模型目录测试。
- Create: `tests/model-download.test.js` — 多模型缓存与校验测试。
- Modify: `tests/whisper-state.test.js` — 切换保护和多次转写测试。
- Create: `tests/transcriber-manager.test.js` — 同模型复用和跨模型销毁顺序。
- Create: `tests/asset-url-registry.test.js` — 对象 URL 回收测试。
- Create: `tests/sidepanel-scope.test.js` — 逐标签启用逻辑测试。
- Modify: `tests/note-format.test.js` — 多模型转写导出测试。
- Modify: `tests/manifest.test.js` — 新入口、权限和版本测试。
- Modify: `docs/ACCEPTANCE.md`、`README.md`、`docs/PRIVACY.md`、`docs/STORE_LISTING.md` — 人工验收与披露。

## Task 1: 建立固定 Whisper 模型目录

**Files:**

- Modify: `src/core/model-config.js`
- Modify: `tests/model-config.test.js`

- [ ] **Step 1: 写模型目录失败测试**

在 `tests/model-config.test.js` 中覆盖固定顺序、文件大小、SHA-256、固定 revision、默认模型和非法 ID：

```js {.line-numbers}
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WHISPER_MODEL_ID,
  WHISPER_MODEL,
  WHISPER_MODELS,
  getWhisperModel,
} from "../src/core/model-config.js";

test("Whisper 模型目录固定为三种可选模型", () => {
  assert.deepEqual(
    WHISPER_MODELS.map(({ id, size }) => ({ id, size })),
    [
      { id: "base-q5_1", size: 59_707_625 },
      { id: "small-q5_1", size: 190_085_487 },
      { id: "medium-q5_0", size: 539_212_467 },
    ],
  );
  for (const model of WHISPER_MODELS) {
    assert.match(model.sha256, /^[a-f0-9]{64}$/);
    assert.match(model.url, /98aa99a0a9db05ae2342309f5096248665f7cba3/);
  }
});

test("默认模型兼容旧调用方", () => {
  assert.equal(DEFAULT_WHISPER_MODEL_ID, "base-q5_1");
  assert.equal(WHISPER_MODEL, getWhisperModel(DEFAULT_WHISPER_MODEL_ID));
});

test("拒绝未知模型 ID", () => {
  assert.throws(() => getWhisperModel("large-v3"), /未知 Whisper 模型/);
});
```

- [ ] **Step 2: 运行模型目录测试并确认失败**

Run: `node --test tests/model-config.test.js`

Expected: FAIL，提示缺少 `WHISPER_MODELS`、`DEFAULT_WHISPER_MODEL_ID` 或 `getWhisperModel` 导出。

- [ ] **Step 3: 实现只读模型目录**

在 `src/core/model-config.js` 中保留 `WHISPER_ORIGINS`，将单模型常量改为：

```js {.line-numbers}
const MODEL_REVISION = "98aa99a0a9db05ae2342309f5096248665f7cba3";
const MODEL_CACHE_NAME = "video-notes-whisper-v1";

export const DEFAULT_WHISPER_MODEL_ID = "base-q5_1";

export const WHISPER_MODELS = Object.freeze([
  {
    id: "base-q5_1",
    label: "Base · 57 MiB",
    filename: "ggml-base-q5_1.bin",
    size: 59_707_625,
    sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    recommended: true,
  },
  {
    id: "small-q5_1",
    label: "Small · 181 MiB",
    filename: "ggml-small-q5_1.bin",
    size: 190_085_487,
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
  },
  {
    id: "medium-q5_0",
    label: "Medium · 514 MiB",
    filename: "ggml-medium-q5_0.bin",
    size: 539_212_467,
    sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
    experimental: true,
  },
].map((model) => Object.freeze({
  ...model,
  url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/${model.filename}`,
  cacheName: MODEL_CACHE_NAME,
})));

export function getWhisperModel(modelId) {
  const model = WHISPER_MODELS.find(({ id }) => id === modelId);
  if (!model) throw new Error(`未知 Whisper 模型：${modelId}`);
  return model;
}

export const WHISPER_MODEL = getWhisperModel(DEFAULT_WHISPER_MODEL_ID);
```

- [ ] **Step 4: 运行目标测试和完整测试**

Run: `node --test tests/model-config.test.js && npm test`

Expected: PASS。

- [ ] **Step 5: 提交任务 1**

```bash {.line-numbers}
git add src/core/model-config.js tests/model-config.test.js
git commit -m "新增: 配置三种 Whisper 模型"
```

## Task 2: 按模型隔离下载、缓存与完整性校验

**Files:**

- Create: `src/core/model-download.js`
- Create: `tests/model-download.test.js`
- Modify: `src/offscreen.js`
- Modify: `src/background.js`
- Modify: `scripts/build-extension.mjs`

- [ ] **Step 1: 写多模型缓存失败测试**

测试使用小型虚拟模型和内存 Cache，不下载真实权重。核心用例：

```js {.line-numbers}
import assert from "node:assert/strict";
import test from "node:test";

import { createModelDownloader, modelChunkKey } from "../src/core/model-download.js";

test("不同模型使用独立完整文件键和分块键", async () => {
  const base = { id: "base", url: "https://models/base.bin", size: 4, sha256: "base-sha", cacheName: "models" };
  const small = { id: "small", url: "https://models/small.bin", size: 4, sha256: "small-sha", cacheName: "models" };
  assert.notEqual(modelChunkKey(base, 0), modelChunkKey(small, 0));
});

test("下载完成只清理当前模型分块并保留其他模型", async () => {
  const harness = createDownloadHarness();
  await harness.downloader.download(harness.models.base);
  await harness.downloader.download(harness.models.small);
  assert.deepEqual(await harness.downloader.cachedIds(Object.values(harness.models)), ["base", "small"]);
  assert.equal(harness.cache.has(modelChunkKey(harness.models.base, 0)), false);
  assert.equal(harness.cache.has(harness.models.small.url), true);
});

test("大小或摘要校验失败时不写入完整模型", async () => {
  const harness = createDownloadHarness({ corruptModelId: "small" });
  await assert.rejects(() => harness.downloader.download(harness.models.small), /校验失败/);
  assert.equal(harness.cache.has(harness.models.small.url), false);
});

test("中断后复用当前模型已经缓存的分块", async () => {
  const harness = createDownloadHarness({ failAfterChunk: 1 });
  await assert.rejects(() => harness.downloader.download(harness.models.small));
  const requestsBeforeRetry = harness.rangeRequests.length;
  harness.resume();
  await harness.downloader.download(harness.models.small);
  assert.equal(harness.rangeRequests.includes("bytes=0-1", requestsBeforeRetry), false);
});
```

测试文件内的 `createDownloadHarness()` 需注入 `openCache`、`fetchResource`、`digest`、`readBundled`、`onProgress` 和 `clearProgress`，让下载算法脱离 Chrome API 可测。

- [ ] **Step 2: 运行下载测试并确认失败**

Run: `node --test tests/model-download.test.js`

Expected: FAIL，提示找不到 `src/core/model-download.js`。

- [ ] **Step 3: 提取可注入的下载器**

在 `src/core/model-download.js` 暴露：

```js {.line-numbers}
export function modelChunkKey(model, offset) {
  return `${model.url}?video-notes-model=${model.id}&chunk=${offset}`;
}

export function createModelDownloader({
  openCache,
  fetchResource,
  digest,
  readBundled,
  onProgress = async () => {},
  clearProgress = async () => {},
  chunkSize = 4 * 1024 * 1024,
}) {
  return {
    cached(model),
    cachedIds(models),
    download(model),
  };
}
```

实现要求：

- `cached(model)` 先查 `model.url`，只对 `base-q5_1` 尝试内置文件。
- `cachedIds(models)` 按模型目录顺序返回已缓存 ID。
- `download(model)` 复用当前 Range 分块策略，进度回调携带 `{ modelId, downloadedBytes, totalBytes }`。
- 完整文件长度和 SHA-256 同时通过后才写 `model.url`。
- 校验失败只清理当前模型的分块和完整文件。
- 下载完成不删除其他模型。

- [ ] **Step 4: 在隐藏页面接入下载器**

`src/offscreen.js` 用 `createModelDownloader()` 代替固定 `WHISPER_MODEL` 下载函数，并处理：

```js {.line-numbers}
case "GET_MODEL_CACHE_STATUS":
  return { cachedModelIds: await modelDownloader.cachedIds(WHISPER_MODELS) };
case "DOWNLOAD_MODEL":
  return modelDownloader.download(getWhisperModel(message.modelId));
```

下载进度写入以下存储键：

```js {.line-numbers}
{
  whisperDownloadModel,
  whisperDownloadedBytes,
}
```

`src/background.js` 的恢复逻辑改为询问全部缓存 ID；旧的 `whisperModel` 只作为迁移输入，不再作为模型可用性的唯一依据。沿用 `video-notes-whisper-v1` Cache Storage 名称和 Base 正式 URL，使旧安装的 Base 缓存继续命中。`scripts/build-extension.mjs` 继续只识别可选的内置 `ggml-base-q5_1.bin`，不把另外两个大模型加入发布包。

后台在用户点击下载时申请 `WHISPER_ORIGINS`，下载成功或失败后都在 `finally` 中撤销权限；分块仍保留，允许稍后重新授权并续传。

- [ ] **Step 5: 运行目标测试、完整测试和构建**

Run: `node --test tests/model-download.test.js tests/model-config.test.js && npm test && npm run build`

Expected: 全部 PASS，`dist/models/` 最多包含 Base 权重。

- [ ] **Step 6: 提交任务 2**

```bash {.line-numbers}
git add src/core/model-download.js tests/model-download.test.js src/offscreen.js src/background.js scripts/build-extension.mjs
git commit -m "新增: 支持多模型下载与独立缓存"
```

## Task 3: 切换模型并确保单个 Whisper 实例

**Files:**

- Modify: `src/core/whisper-state.js`
- Modify: `tests/whisper-state.test.js`
- Create: `src/core/transcriber-manager.js`
- Create: `tests/transcriber-manager.test.js`
- Modify: `src/offscreen.js`
- Modify: `src/background.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.css`
- Modify: `src/sidepanel.js`

- [ ] **Step 1: 写模型切换约束失败测试**

在 `tests/whisper-state.test.js` 中增加：

```js {.line-numbers}
import { assertModelSwitchAllowed } from "../src/core/whisper-state.js";

test("空闲状态允许切换模型", () => {
  assert.doesNotThrow(() => assertModelSwitchAllowed({
    whisperState: "ready",
    modelDownloading: false,
    transcriptionCount: 0,
    recording: false,
  }));
});

for (const busyState of [
  { whisperState: "downloading", modelDownloading: true, transcriptionCount: 0, recording: false },
  { whisperState: "recording", modelDownloading: false, transcriptionCount: 0, recording: true },
  { whisperState: "transcribing", modelDownloading: false, transcriptionCount: 1, recording: false },
]) {
  test(`忙碌状态 ${busyState.whisperState} 拒绝切换模型`, () => {
    assert.throws(() => assertModelSwitchAllowed(busyState), /任务结束后再切换/);
  });
}
```

在 `tests/transcriber-manager.test.js` 中验证单实例不变量：

```js {.line-numbers}
import assert from "node:assert/strict";
import test from "node:test";

import { createTranscriberManager } from "../src/core/transcriber-manager.js";

test("同一模型复用实例，切换模型先销毁旧实例", async () => {
  const events = [];
  const manager = createTranscriberManager({
    create: async (modelId) => {
      events.push(`create:${modelId}`);
      return {
        isReady: true,
        destroy: async () => events.push(`destroy:${modelId}`),
      };
    },
  });
  const base = await manager.ensure("base-q5_1");
  assert.equal(await manager.ensure("base-q5_1"), base);
  await manager.ensure("small-q5_1");
  assert.deepEqual(events, [
    "create:base-q5_1",
    "destroy:base-q5_1",
    "create:small-q5_1",
  ]);
  assert.equal(manager.loadedModelId, "small-q5_1");
});
```

- [ ] **Step 2: 运行切换测试并确认失败**

Run: `node --test tests/whisper-state.test.js tests/transcriber-manager.test.js`

Expected: FAIL，提示缺少 `assertModelSwitchAllowed` 和 `transcriber-manager.js`。

- [ ] **Step 3: 实现切换判断和存储迁移**

在 `src/core/whisper-state.js` 增加纯函数：

```js {.line-numbers}
export function assertModelSwitchAllowed({
  whisperState,
  modelDownloading,
  transcriptionCount,
  recording,
}) {
  if (
    modelDownloading
    || recording
    || transcriptionCount > 0
    || ["downloading", "recording", "transcribing"].includes(whisperState)
  ) {
    throw new Error("请等待当前语音任务结束后再切换模型");
  }
}
```

`src/background.js` 初始化时迁移旧存储：

```js {.line-numbers}
const whisperSelectedModel = getWhisperModel(
  settings.whisperSelectedModel
    || settings.whisperModel
    || DEFAULT_WHISPER_MODEL_ID,
).id;
```

迁移完成写 `whisperSelectedModel`，后续状态读取不再依赖旧键 `whisperModel`。为兼容已经安装的版本，本期不主动删除旧键。

- [ ] **Step 4: 实现单实例模型装载**

新增 `src/core/transcriber-manager.js`，暴露 `createTranscriberManager({ create })`，返回 `ensure(modelId)`、`dispose()` 和只读 `loadedModelId`。`ensure()` 同模型直接复用；跨模型先 `await dispose()` 再调用 `create(modelId)`；初始化期间对不同模型请求报“模型正在切换”。

`src/offscreen.js` 用该管理器将 `ensureTranscriber()` 改为 `ensureTranscriber(modelId)`：

```js {.line-numbers}
const transcriberManager = createTranscriberManager({
  create: async (modelId) => {
  const model = getWhisperModel(modelId);
    const response = await modelDownloader.cached(model);
    if (!response) throw new Error(`尚未下载 ${model.label}`);
    return createFileTranscriber(model, response);
  },
});

const ensureTranscriber = (modelId) => transcriberManager.ensure(modelId);
```

`createFileTranscriber()` 初始化失败时销毁已创建的半成品实例再抛错。`GET_PROCESSING_STATE` 从管理器返回 `loadedModelId`。`SELECT_WHISPER_MODEL` 在后台和隐藏页各检查一次忙碌状态，成功后调用 `transcriberManager.dispose()` 并写入选择。下载模型完成后选择该模型，但不自动删除或卸载其他缓存。

- [ ] **Step 5: 增加模型设置界面**

`src/sidepanel.html` 在“本地 Whisper”设置区增加：

```html {.line-numbers}
<label for="whisper-model-select">转写模型</label>
<select id="whisper-model-select"></select>
<button id="whisper-model-action" type="button">下载并使用</button>
<p id="whisper-model-warning" hidden></p>
```

`src/sidepanel.js` 的状态请求统一为 `GET_WHISPER_STATUS`，响应固定为：

```js {.line-numbers}
{
  whisperState,
  selectedModelId: whisperSelectedModel,
  loadedModelId,
  cachedModelIds,
  download: modelDownloading
    ? { modelId: whisperDownloadModel, downloadedBytes }
    : null,
  models: WHISPER_MODELS.map(({ id, label, size, recommended, experimental }) => ({
    id,
    label,
    size,
    recommended: Boolean(recommended),
    experimental: Boolean(experimental),
  })),
}
```

界面规则：

- 选中已缓存模型时，按钮显示“使用此模型”。
- 选中未缓存模型时，按钮显示“下载并使用”，点击后再申请模型源权限。
- `base-q5_1` 标记“推荐”；`medium-q5_0` 显示“约 514 MiB，当前设备可能转写较慢”的提示。
- 下载、录音和转写期间禁用下拉框和按钮。
- 侧栏重开后从存储恢复选择和进度。

- [ ] **Step 6: 运行测试、构建并检查界面元素**

Run: `node --test tests/whisper-state.test.js tests/transcriber-manager.test.js tests/manifest.test.js && npm test && npm run build`

Expected: 全部 PASS；`dist/sidepanel.html` 包含三个模型相关控件；构建产物没有远程 JavaScript。

- [ ] **Step 7: 提交任务 3**

```bash {.line-numbers}
git add src/core/whisper-state.js tests/whisper-state.test.js src/core/transcriber-manager.js tests/transcriber-manager.test.js src/offscreen.js src/background.js src/sidepanel.html src/sidepanel.css src/sidepanel.js
git commit -m "新增: 支持切换本地 Whisper 模型"
```

## Task 4: 固定任务模型并保留重复转写历史

**Files:**

- Modify: `src/core/whisper-state.js`
- Modify: `tests/whisper-state.test.js`
- Modify: `src/core/note-format.js`
- Modify: `tests/note-format.test.js`
- Modify: `src/offscreen.js`
- Modify: `src/background.js`
- Modify: `src/sidepanel.js`
- Modify: `src/sidepanel.css`

- [ ] **Step 1: 写追加式转写历史失败测试**

在 `tests/whisper-state.test.js` 中替换旧的单结果断言，覆盖首次转写、已编辑正文和重复模型结果：

```js {.line-numbers}
test("首次语音转写写入正文并记录模型", () => {
  const note = applyTranscript(
    { body: "", userEditVersion: 0, transcriptionRuns: [] },
    "第一版",
    { modelId: "base-q5_1", source: "automatic", createdAt: 100 },
  );
  assert.equal(note.body, "第一版");
  assert.equal(note.transcriptionModelId, "base-q5_1");
  assert.deepEqual(note.transcriptionRuns, [{
    modelId: "base-q5_1",
    text: "第一版",
    source: "automatic",
    createdAt: 100,
  }]);
});

test("用户编辑后的重复转写只更新候选和历史", () => {
  const note = applyTranscript(
    {
      body: "我的修改",
      userEditVersion: 1,
      transcriptionRuns: [{ modelId: "base-q5_1", text: "第一版", source: "automatic", createdAt: 100 }],
    },
    "第二版",
    { modelId: "small-q5_1", source: "manual", createdAt: 200 },
  );
  assert.equal(note.body, "我的修改");
  assert.equal(note.transcriptCandidate, "第二版");
  assert.equal(note.transcriptionRuns.length, 2);
  assert.equal(note.transcriptionRuns[1].modelId, "small-q5_1");
});
```

再给 `tests/note-format.test.js` 增加导出断言：个人正文出现在模型对比之前，每次转写都标注模型，结果放入可折叠 `<details>` 区域。

- [ ] **Step 2: 运行状态和导出测试并确认失败**

Run: `node --test tests/whisper-state.test.js tests/note-format.test.js`

Expected: FAIL，旧 `applyTranscript()` 不接受元数据且 Markdown 没有转写历史。

- [ ] **Step 3: 扩展笔记结构并兼容旧数据**

`applyTranscript()` 改为：

```js {.line-numbers}
export function applyTranscript(note, transcript, {
  modelId,
  source,
  createdAt = Date.now(),
}) {
  const text = String(transcript ?? "").trim();
  const run = { modelId, text, source, createdAt };
  const next = {
    ...note,
    transcriptionStatus: "complete",
    transcriptionModelId: modelId,
    transcriptionRuns: [...(note.transcriptionRuns ?? []), run],
  };
  if ((note.userEditVersion ?? 0) === 0 && !note.body?.trim()) {
    return { ...next, body: text, transcriptCandidate: "" };
  }
  return { ...next, transcriptCandidate: text };
}
```

新建语音笔记时写入：

```js {.line-numbers}
{
  transcriptionModelId: "",
  transcriptionRuns: [],
}
```

读取旧笔记时允许字段缺失，通过 `?? []` 和 `?? ""` 兼容，不执行一次性 IndexedDB 批量迁移。

- [ ] **Step 4: 让每个任务固定模型 ID**

后台增加：

```js {.line-numbers}
async function enqueueTranscription(noteId, modelId, source) {
  getWhisperModel(modelId);
  await sendToOffscreen({
    type: "TRANSCRIBE_NOTE",
    noteId,
    modelId,
    source,
  });
}
```

初次录音停止时读取当时的 `whisperSelectedModel`，用 `source: "automatic"` 入队。侧栏发 `RETRANSCRIBE_NOTE` 时，后台验证笔记是语音笔记且存在 `audioKey`，再用当前模型和 `source: "manual"` 入队。入队前把目标 `modelId` 写入笔记的 `transcriptionModelId` 并将状态置为 `pending`，确保服务工作线程重启后仍能恢复正确模型。隐藏页的队列项保存 `{ noteId, modelId, source }`，不得在实际执行时重新读取当前选择。

恢复未完成任务时使用笔记的 `transcriptionModelId`；旧笔记缺失该字段时回退到当前选择，并立刻写回笔记。恢复来源根据历史推断：没有成功记录时为 `automatic`，已有记录时为 `manual`。

- [ ] **Step 5: 在侧栏提供重新转写和结果对比**

每张语音卡片增加“用当前模型重新转写”按钮：

- 没有音频、模型未缓存或当前繁忙时禁用，并显示具体原因。
- 点击后卡片显示“使用 Small 转写中…”等模型名称。
- `transcriptionRuns.length > 1` 时展示折叠的“查看 3 个转写结果”。
- 每个结果显示模型名称、时间和文本，不提供覆盖正文按钮。

`buildMarkdown()` 在个人正文、截图和音频之后追加：

```markdown {.line-numbers}
<details>
<summary>本地转写结果（3 个模型）</summary>

- Base · 57 MiB：第一版文本
- Small · 181 MiB：第二版文本
- Medium · 514 MiB：第三版文本

</details>
```

字幕块仍排在最后，保持个人内容优先。

- [ ] **Step 6: 运行目标测试、完整测试和构建**

Run: `node --test tests/whisper-state.test.js tests/note-format.test.js && npm test && npm run build`

Expected: 全部 PASS；旧笔记仍可渲染和导出；同一录音三次转写保留三条历史。

- [ ] **Step 7: 提交任务 4**

```bash {.line-numbers}
git add src/core/whisper-state.js tests/whisper-state.test.js src/core/note-format.js tests/note-format.test.js src/offscreen.js src/background.js src/sidepanel.js src/sidepanel.css
git commit -m "新增: 保存多模型转写对比"
```

## Task 5: 在侧栏时间线展示截图和原始录音

**Files:**

- Create: `src/core/asset-url-registry.js`
- Create: `tests/asset-url-registry.test.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.css`
- Modify: `src/sidepanel.js`
- Modify: `tests/manifest.test.js`

- [ ] **Step 1: 写对象 URL 生命周期失败测试**

在 `tests/asset-url-registry.test.js` 中覆盖创建、替换和集中回收：

```js {.line-numbers}
import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssetUrlRegistry,
  loadNoteAssets,
} from "../src/core/asset-url-registry.js";

test("替换同一资产时回收旧 URL", () => {
  const revoked = [];
  let sequence = 0;
  const registry = createAssetUrlRegistry({
    createObjectURL: () => `blob:test-${++sequence}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  assert.equal(registry.set("images/1", new Blob()), "blob:test-1");
  assert.equal(registry.set("images/1", new Blob()), "blob:test-2");
  assert.deepEqual(revoked, ["blob:test-1"]);
});

test("刷新和卸载时回收全部 URL", () => {
  const revoked = [];
  const registry = createAssetUrlRegistry({
    createObjectURL: (_, key) => `blob:${key}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  registry.set("images/1", new Blob());
  registry.set("audio/1", new Blob());
  registry.revokeAll();
  assert.equal(registry.size, 0);
  assert.equal(revoked.length, 2);
});

test("读取截图和录音并报告缺失资产", async () => {
  const registry = createAssetUrlRegistry({
    createObjectURL: () => "blob:asset",
    revokeObjectURL: () => {},
  });
  const assets = new Map([
    ["images/1", new Blob(["image"])],
  ]);
  const result = await loadNoteAssets(
    { screenshotKey: "images/1", audioKey: "audio/1" },
    { getAsset: (key) => assets.get(key), registry },
  );
  assert.equal(result.screenshotUrl, "blob:asset");
  assert.equal(result.audioUrl, "");
  assert.deepEqual(result.warnings, ["录音资产缺失"]);
});
```

- [ ] **Step 2: 运行对象 URL 测试并确认失败**

Run: `node --test tests/asset-url-registry.test.js`

Expected: FAIL，提示找不到 `asset-url-registry.js`。

- [ ] **Step 3: 实现对象 URL 注册表**

在 `src/core/asset-url-registry.js` 暴露：

```js {.line-numbers}
export function createAssetUrlRegistry({
  createObjectURL = URL.createObjectURL.bind(URL),
  revokeObjectURL = URL.revokeObjectURL.bind(URL),
} = {}) {
  const urls = new Map();
  return {
    set(key, blob) {
      const previous = urls.get(key);
      if (previous) revokeObjectURL(previous);
      const url = createObjectURL(blob);
      urls.set(key, url);
      return url;
    },
    revokeAll() {
      for (const url of urls.values()) revokeObjectURL(url);
      urls.clear();
    },
    get size() {
      return urls.size;
    },
  };
}

export async function loadNoteAssets(note, { getAsset, registry }) {
  const result = { screenshotUrl: "", audioUrl: "", warnings: [] };
  const load = async (key, field, warning) => {
    if (!key) return;
    const blob = await getAsset(key);
    if (!blob) {
      result.warnings.push(warning);
      return;
    }
    result[field] = registry.set(key, blob);
  };
  await Promise.all([
    load(note.screenshotKey, "screenshotUrl", "截图资产缺失"),
    load(note.audioKey, "audioUrl", "录音资产缺失"),
  ]);
  return result;
}
```

`set(key, blob)` 必须先回收旧 URL，再保存和返回新 URL；`revokeAll()` 回收 Map 中的全部 URL 后清空。`loadNoteAssets()` 分别读取 `screenshotKey` 和 `audioKey`，只把实际 Blob 交给注册表，并返回“截图资产缺失”或“录音资产缺失”告警。

- [ ] **Step 4: 让侧栏读取 IndexedDB 资产**

`src/sidepanel.js` 直接导入并创建 `VideoNotesRepository`，每次 `renderNotes()`：

1. 增加递增 `renderGeneration`，防止旧异步读取写入新会话的 DOM。
2. 先 `assetUrls.revokeAll()`，再同步建立卡片骨架。
3. 对 `screenshotKey` 和 `audioKey` 并行调用 `repository.getAsset(key)`。
4. 当前 generation 仍有效时创建对象 URL 并挂入卡片。
5. 缺失资产时在该卡片显示“截图文件缺失”或“录音文件缺失”，不影响其余内容。

截图元素固定为：

```html {.line-numbers}
<button class="note-screenshot-button" type="button" aria-label="放大标记截图">
  <img class="note-screenshot" loading="lazy" alt="标记时的播放器截图">
</button>
```

语音元素固定为：

```html {.line-numbers}
<audio class="note-audio" controls preload="metadata"></audio>
```

文字笔记有 `screenshotKey` 时同样显示缩略图；语音笔记同时显示截图和音频。

- [ ] **Step 5: 增加可关闭的图片预览**

在 `src/sidepanel.html` 增加原生对话框：

```html {.line-numbers}
<dialog id="screenshot-dialog" aria-label="标记截图预览">
  <button id="screenshot-dialog-close" type="button" aria-label="关闭截图">关闭</button>
  <img id="screenshot-dialog-image" alt="标记时的播放器截图大图">
</dialog>
```

行为要求：点击缩略图打开；关闭按钮、`Esc` 和点击背景关闭；切换会话或侧栏卸载时先关闭对话框，再回收 URL。CSS 限制缩略图比例和预览最大尺寸，保留键盘焦点轮廓。

- [ ] **Step 6: 增加静态产物检查并运行验证**

在 `tests/manifest.test.js` 中断言 `sidepanel.html` 存在对话框、音频样式入口，构建后运行：

Run: `node --test tests/asset-url-registry.test.js tests/manifest.test.js && npm test && npm run build`

Expected: 全部 PASS；`dist/sidepanel.js` 不包含 `data:` 形式的大型资产；侧栏关闭时无持续播放的音频。

- [ ] **Step 7: 提交任务 5**

```bash {.line-numbers}
git add src/core/asset-url-registry.js tests/asset-url-registry.test.js src/sidepanel.html src/sidepanel.css src/sidepanel.js tests/manifest.test.js
git commit -m "新增: 在时间线展示截图和录音"
```

## Task 6: 让侧栏只跟随受支持的课程标签

**Files:**

- Create: `src/core/sidepanel-scope.js`
- Create: `tests/sidepanel-scope.test.js`
- Modify: `src/background.js`
- Modify: `src/content.js`
- Modify: `tests/manifest.test.js`
- Modify: `docs/ACCEPTANCE.md`

- [ ] **Step 1: 写逐标签侧栏配置失败测试**

复用 `parseVideoContext()` 判定支持范围：

```js {.line-numbers}
import assert from "node:assert/strict";
import test from "node:test";

import { sidePanelOptionsForTab } from "../src/core/sidepanel-scope.js";

test("YouTube 和哔哩哔哩视频标签启用侧栏", () => {
  assert.deepEqual(sidePanelOptionsForTab({ id: 7, url: "https://www.youtube.com/watch?v=abc123" }), {
    tabId: 7,
    path: "sidepanel.html",
    enabled: true,
  });
  assert.deepEqual(sidePanelOptionsForTab({ id: 8, url: "https://www.bilibili.com/video/BV1xx411c7mD?p=2" }), {
    tabId: 8,
    path: "sidepanel.html",
    enabled: true,
  });
});

test("普通网页和无 URL 标签禁用侧栏", () => {
  assert.deepEqual(sidePanelOptionsForTab({ id: 9, url: "https://example.com/" }), {
    tabId: 9,
    enabled: false,
  });
  assert.deepEqual(sidePanelOptionsForTab({ id: 10 }), { tabId: 10, enabled: false });
});

test("没有数字 tabId 时拒绝配置", () => {
  assert.throws(() => sidePanelOptionsForTab({ url: "https://example.com/" }), /tabId/);
});
```

- [ ] **Step 2: 运行范围测试并确认失败**

Run: `node --test tests/sidepanel-scope.test.js`

Expected: FAIL，提示找不到 `sidepanel-scope.js`。

- [ ] **Step 3: 实现纯函数范围判断**

`src/core/sidepanel-scope.js`：

```js {.line-numbers}
import { parseVideoContext } from "./site-adapter.js";

export function sidePanelOptionsForTab(tab) {
  if (!Number.isInteger(tab?.id)) throw new Error("缺少有效 tabId");
  const supported = Boolean(tab.url && parseVideoContext(tab.url));
  return supported
    ? { tabId: tab.id, path: "sidepanel.html", enabled: true }
    : { tabId: tab.id, enabled: false };
}
```

- [ ] **Step 4: 后台按标签配置侧栏**

在 `src/background.js` 增加：

```js {.line-numbers}
async function configureSidePanelForTab(tab) {
  await chrome.sidePanel.setOptions(sidePanelOptionsForTab(tab));
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await configureSidePanelForTab(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    void configureSidePanelForTab({ ...tab, id: tabId });
  }
});
```

同时完成：

- 安装和浏览器启动时查询已有标签并逐个配置，处理监听器注册前已打开的课程页。
- `tabs.onCreated` 立即把 URL 尚不可读的新标签设为禁用，后续由 `onUpdated` 决定是否启用。
- 监听 `tabs.onRemoved`，若删除的是当前语音笔记标签，沿用现有强制结束录音逻辑。
- 每个监听器捕获并记录单标签错误，避免一个受限页面中断全部配置。
- 保留 `setPanelBehavior({ openPanelOnActionClick: true })`；普通标签点击扩展图标时不打开侧栏。
- 不新增 `tabs` 权限；现有 YouTube、哔哩哔哩主机权限已让对应 URL 可见，普通标签只需收到监听器提供的 URL 或按无 URL 禁用。

- [ ] **Step 5: 处理课程站内跳转和会话刷新**

YouTube 和哔哩哔哩是单页应用。`src/content.js` 现有 URL 观察在视频上下文改变时，除更新内部适配器外，向后台发送：

```js {.line-numbers}
{
  type: "CONTEXT_CHANGED",
  context: currentContext,
}
```

后台收到后重新配置发送者标签，并广播现有 `ACTIVE_CONTEXT_CHANGED` 消息。`tabs.onActivated` 配置完成后也广播该消息，已打开的侧栏沿用现有监听调用 `refresh()`，达到：课程 A → 课程 B 自动显示 B；普通页隐藏；返回 A 后重新读取 A 会话。

- [ ] **Step 6: 更新静态测试和人工验收项**

`tests/manifest.test.js` 断言：

- 保留 `side_panel.default_path` 作为页面入口。
- 后台构建产物包含 `chrome.sidePanel.setOptions`。
- Manifest 没有新增全局 `<all_urls>` 或 `tabs` 权限。

`docs/ACCEPTANCE.md` 增加三标签场景：课程 A、课程 B、普通网页依次切换；验证显示、隐藏和会话恢复。

- [ ] **Step 7: 运行目标测试、完整测试和构建**

Run: `node --test tests/sidepanel-scope.test.js tests/site-adapter.test.js tests/manifest.test.js && npm test && npm run build`

Expected: 全部 PASS；普通标签的 side panel option 为 `enabled: false`。

- [ ] **Step 8: 提交任务 6**

```bash {.line-numbers}
git add src/core/sidepanel-scope.js tests/sidepanel-scope.test.js src/background.js src/content.js tests/manifest.test.js docs/ACCEPTANCE.md
git commit -m "修复: 让侧栏跟随课程标签切换"
```

## Task 7: 发布文档、版本与端到端验收

**Files:**

- Modify: `README.md`
- Modify: `docs/PRIVACY.md`
- Modify: `docs/STORE_LISTING.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 更新用户文档和隐私披露**

文档明确写出：

- 三个模型的显示名称、准确大小、用途和 Medium 性能提示。
- 权重首次下载自固定 Hugging Face revision，录音和转写内容不上传。
- 已下载模型会全部保留，本期需通过 Edge 清除扩展数据才能统一释放空间。
- 截图和录音在侧栏的查看方式，重复转写不会覆盖用户编辑正文。
- 侧栏只在 YouTube 和哔哩哔哩普通视频页启用。

- [ ] **Step 2: 更新版本并补静态断言**

将 `manifest.json`、`package.json` 和锁文件版本同步为 `0.2.0`。`tests/manifest.test.js` 断言三处版本一致，并继续检查权限最小化、CSP、可选模型源权限和所有本地执行代码入口。

- [ ] **Step 3: 运行完整自动化验证**

Run:

```bash {.line-numbers}
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-0.2.0.zip
git diff --check
```

Expected:

- 所有测试通过。
- 构建和打包成功。
- ZIP 完整性通过，根目录包含 `manifest.json`、侧栏和隐藏页资源。
- ZIP 不包含 Small 或 Medium 权重。
- `git diff --check` 无空白错误。

- [ ] **Step 4: 在 Edge 150 完成人工验收**

按 `docs/ACCEPTANCE.md` 执行并记录结果：

1. 分别下载 Base、Small、Medium；中断一次 Small 下载后续传；重启浏览器后确认三者仍标记已下载。
2. 用同一条 3–15 秒中文及中英混合录音依次使用三个模型重新转写，卡片和 Markdown 保留三条结果。
3. 编辑个人正文后重新转写，正文保持不变，新结果进入候选和历史。
4. 创建一条文字笔记和一条语音笔记，侧栏均显示截图；语音笔记可以播放原始录音；缩略图可以放大和关闭。
5. 依次切换课程 A、普通网页、课程 B、课程 A，侧栏按预期显示、隐藏、换会话和恢复。
6. 导出 ZIP，检查 Markdown、`images/`、`audio/`、时点链接和相对路径。
7. 在拒绝麦克风、断网和关闭标签等异常路径中确认视频与录音租约均释放。

- [ ] **Step 5: 提交发布加固**

```bash {.line-numbers}
git add README.md docs/PRIVACY.md docs/STORE_LISTING.md docs/ACCEPTANCE.md manifest.json package.json package-lock.json tests/manifest.test.js
git commit -m "更新: 发布多模型视频笔记 0.2.0"
```

- [ ] **Step 6: 请求代码审查并再次验证**

使用 `superpowers:requesting-code-review` 检查需求覆盖、数据兼容、对象 URL 回收、模型并发和逐标签侧栏。修复发现的问题后，重新运行 Step 3 的全部命令；准备交付前使用 `superpowers:verification-before-completion` 核对最终输出。

## Completion Criteria

- 用户可以看见三个固定模型，分别下载、保留并手动切换。
- 下载、录音或转写进行时不能切换模型，内存中至多有一个 Whisper 实例。
- 每次转写任务固定入队时的模型；同一音频的全部模型结果均可查看和导出。
- 任何重复转写都不会覆盖已编辑的个人正文。
- 文字与语音笔记均在侧栏显示截图；语音笔记还可播放原始录音；截图可放大。
- 切换课程 A、普通网页、课程 B、课程 A 时，侧栏依次显示 A、隐藏、显示 B、恢复 A。
- 现有录音、自动暂停、截图、ZIP 导出、字幕和网课声伴协作测试保持通过。
- 自动化测试、构建、打包、ZIP 校验和 Edge 人工验收全部完成。
