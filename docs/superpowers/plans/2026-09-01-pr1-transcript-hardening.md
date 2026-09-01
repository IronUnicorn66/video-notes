# PR #1 完整字幕安全加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 PR #1 中跨视频字幕误用、捕获包装泄漏、翻译授权竞态、权限撤销和错误时间跳转问题，使其满足合并条件。

**Architecture:** 以 `videoId/sessionId` 作为字幕从页面发现、播放器捕获、侧栏展示、翻译和跳转的端到端身份边界。页面主世界捕获在同一窗口内串行执行；翻译授权和权限设置通过可独立测试的核心函数保持快照与事务顺序，侧栏只负责 DOM 映射。

**Tech Stack:** Edge Manifest V3、原生 ES modules、Node.js 22 `node:test`、esbuild。

**Spec:** [GitHub PR #1](https://github.com/IronUnicorn66/video-notes/pull/1) 及 2026-09-01 合并前独立审查结论。

## Global Constraints

- 不新增、升级或删除生产依赖。
- 所有行为修改先添加能在当前 HEAD 上按预期失败的回归测试。
- YouTube 字幕 URL 必须为 HTTPS、允许的 YouTube 主机、精确 `/api/timedtext` 路径，且 `v` 精确匹配当前 `videoId`。
- 译文继续只保留在当前侧栏会话；不得扩大 Manifest 权限。
- 修复批次把扩展补丁版本从 `1.0.15` 递增到 `1.0.16`，并同步 Manifest、包元数据、锁文件、测试和当前发布文档。
- 合并前运行全量 `npm test`、构建、打包、ZIP 完整性、SHA-256、`git diff --check` 和可执行的浏览器视觉检查。

---

### Task 1: 字幕 URL、视频身份与 cue 边界

**Files:**
- Modify: `src/core/youtube-full-transcript.js`
- Modify: `src/content.js`
- Test: `tests/youtube-full-transcript.test.js`

**Interfaces:**
- Consumes: `context.videoId` from `parseVideoContext()`.
- Produces: `readYoutubeFullTranscript(root, { fetchImpl, preferredLanguages, videoId })`；所有结果携带 `videoId`。
- Produces: `transcriptFromYoutubeCapture(capture, expectedVideoId)`；仅接受当前 YouTube 字幕响应。

- [ ] **Step 1: 添加旧脚本、外域、缺失视频 ID 与 malformed cue 的失败测试**

```javascript {.line-numbers}
test("SPA 跳转后只选择当前视频的字幕轨道", () => {
  const tracks = extractYoutubeCaptionTracks([
    playerResponseScript([captionTrack("old-video")]),
    playerResponseScript([captionTrack("current-video")]),
  ], [], "current-video");
  assert.deepEqual(tracks.map((track) => track.videoId), ["current-video"]);
});

test("拒绝外域、缺失 v 和错误 v 的播放器字幕响应", () => {
  assert.equal(transcriptFromYoutubeCapture(capture("https://example.invalid/api/timedtext?v=current"), "current"), null);
  assert.equal(transcriptFromYoutubeCapture(capture("https://www.youtube.com/api/timedtext?lang=en"), "current"), null);
  assert.equal(transcriptFromYoutubeCapture(capture("https://www.youtube.com/api/timedtext?v=old"), "current"), null);
});
```

- [ ] **Step 2: 运行定向测试并确认因当前实现接受旧/外域响应而失败**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/youtube-full-transcript.test.js tests/youtube-transcript-capture.test.js
```

- [ ] **Step 3: 实现统一的严格 URL 校验并让内容脚本传入当前 videoId**

```javascript {.line-numbers}
function youtubeTranscriptUrl(value, expectedVideoId) {
  const url = new URL(value);
  if (url.protocol !== "https:") return null;
  if (!YOUTUBE_TRANSCRIPT_HOSTS.has(url.hostname)) return null;
  if (url.pathname !== "/api/timedtext") return null;
  if (!expectedVideoId || url.searchParams.get("v") !== expectedVideoId) return null;
  return url;
}
```

- [ ] **Step 4: 过滤非数组结构、非有限或负数时间，并运行定向测试至通过**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/youtube-full-transcript.test.js tests/youtube-transcript-capture.test.js
```

- [ ] **Step 5: 提交字幕身份边界修复**

```bash {.line-numbers}
git add src/core/youtube-full-transcript.js src/content.js tests/youtube-full-transcript.test.js tests/youtube-transcript-capture.test.js
git commit -m "修复: 绑定完整字幕与当前视频"
```

### Task 2: 播放器捕获串行化与包装清理

**Files:**
- Modify: `src/core/youtube-transcript-capture.js`
- Modify: `src/background.js`
- Test: `tests/youtube-transcript-capture.test.js`

**Interfaces:**
- Consumes: `captureYoutubePlayerTranscript(timeoutMs, { videoId })` when injected into MAIN world.
- Produces: 同一页面通过 `Symbol.for("video-notes.youtubeTranscriptCapture")` 维护串行 Promise；每次调用结束后恢复原始 `fetch`/XHR 方法。

- [ ] **Step 1: 添加两个并发捕获后必须恢复原始 fetch 的失败测试**

```javascript {.line-numbers}
test("重叠捕获串行执行并恢复页面网络方法", async () => {
  const { runtime, originalFetch } = concurrentPageRuntime();
  const [first, second] = await Promise.all([
    captureYoutubePlayerTranscript(100, runtime),
    captureYoutubePlayerTranscript(100, runtime),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(runtime.window.fetch, originalFetch);
});
```

- [ ] **Step 2: 运行定向测试并确认出现 `LEAKED_WRAPPER` 等价失败**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/youtube-transcript-capture.test.js
```

- [ ] **Step 3: 在注入函数内部用页面级 Promise 链串行捕获，并把包装安装纳入 try/finally**

```javascript {.line-numbers}
const captureKey = Symbol.for("video-notes.youtubeTranscriptCapture");
const previous = pageWindow[captureKey] ?? Promise.resolve();
const run = previous.catch(() => {}).then(performCapture);
pageWindow[captureKey] = run;
try {
  return await run;
} finally {
  if (pageWindow[captureKey] === run) delete pageWindow[captureKey];
}
```

- [ ] **Step 4: 让后台把预期 videoId 传入 MAIN world，并运行捕获测试至通过**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/youtube-transcript-capture.test.js tests/youtube-full-transcript.test.js
```

- [ ] **Step 5: 提交捕获生命周期修复**

```bash {.line-numbers}
git add src/core/youtube-transcript-capture.js src/background.js tests/youtube-transcript-capture.test.js
git commit -m "修复: 串行化播放器字幕捕获"
```

### Task 3: 翻译授权快照与权限设置事务

**Files:**
- Modify: `src/core/full-transcript-translation.js`
- Create: `src/core/full-transcript-translation-settings.js`
- Modify: `src/sidepanel.js`
- Modify: `src/core/i18n.js`
- Test: `tests/full-transcript-translation.test.js`
- Create: `tests/full-transcript-translation-settings.test.js`

**Interfaces:**
- Produces: `authorizeCurrentTranscriptTranslation({ getState, requestPermission }) -> snapshot | null`。
- Produces: `saveTranslationSettings({ storage, permissions, stored, config, values })`。
- Produces: `clearTranslationSettings({ storage, permissions, stored, keys })`。

- [ ] **Step 1: 添加授权等待期间上下文变化、撤销返回 false 和存储失败回滚的失败测试**

```javascript {.line-numbers}
test("权限确认期间切换视频不会返回可翻译快照", async () => {
  let state = { transcript: first, generation: 1, contextKey: "tab:one" };
  const result = authorizeCurrentTranscriptTranslation({
    getState: () => state,
    requestPermission: async () => { state = { transcript: second, generation: 2, contextKey: "tab:two" }; },
  });
  assert.equal(await result, null);
});

test("撤销旧主机失败时保留旧设置且不报告保存成功", async () => {
  await assert.rejects(() => saveTranslationSettings(fixture({ removeResult: false })), /无法撤销旧的翻译 API 权限/);
  assert.deepEqual(storage.values, originalValues);
});
```

- [ ] **Step 2: 运行定向测试并确认新接口缺失或竞态行为失败**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/full-transcript-translation.test.js tests/full-transcript-translation-settings.test.js
```

- [ ] **Step 3: 在权限请求前快照 transcript/generation/contextKey，并在返回后重新校验对象身份**

```javascript {.line-numbers}
const snapshot = await authorizeCurrentTranscriptTranslation({
  getState: () => ({
    transcript: fullTranscript,
    generation: fullTranscriptGeneration,
    contextKey: fullTranscriptContextKey,
  }),
  requestPermission: () => ensureFullTranscriptTranslationPermission(config),
});
if (!snapshot) return;
```

- [ ] **Step 4: 实现权限撤销先于存储删除、切换失败不丢旧元数据、存储失败回收新增权限**

```javascript {.line-numbers}
const removed = await permissions.remove({ origins: [origin] });
if (!removed) throw new Error("无法撤销旧的翻译 API 权限");
```

- [ ] **Step 5: 翻译请求显式发送 `stream: false`，运行定向测试至通过**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/full-transcript-translation.test.js tests/full-transcript-translation-settings.test.js
```

- [ ] **Step 6: 提交翻译与权限生命周期修复**

```bash {.line-numbers}
git add src/core/full-transcript-translation.js src/core/full-transcript-translation-settings.js src/sidepanel.js src/core/i18n.js tests/full-transcript-translation.test.js tests/full-transcript-translation-settings.test.js
git commit -m "修复: 稳定全文翻译授权与权限清理"
```

### Task 4: 跨视频跳转身份校验与旧字幕即时失效

**Files:**
- Create: `src/core/video-command-context.js`
- Modify: `src/content.js`
- Modify: `src/background.js`
- Modify: `src/sidepanel.js`
- Create: `tests/video-command-context.test.js`
- Modify: `tests/sidepanel-transcript-ui.test.js`

**Interfaces:**
- Produces: `seekMediaForVideoContext({ media, context, seconds, expectedSessionId, expectedVideoId }) -> seconds`。
- Consumes: 侧栏 `SEEK_VIDEO` 消息的 `sessionId`、`videoId` 和 `seconds`。

- [ ] **Step 1: 添加错误 session/video 不得修改播放器时间的失败测试**

```javascript {.line-numbers}
test("旧字幕不能跳转新视频", () => {
  const media = { currentTime: 12, duration: 100 };
  assert.throws(() => seekMediaForVideoContext({
    media,
    context: { sessionId: "youtube:new", videoId: "new" },
    expectedSessionId: "youtube:old",
    expectedVideoId: "old",
    seconds: 42,
  }), /当前页面会话不匹配/);
  assert.equal(media.currentTime, 12);
});
```

- [ ] **Step 2: 运行定向测试并确认新接口缺失**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/video-command-context.test.js tests/sidepanel-transcript-ui.test.js
```

- [ ] **Step 3: 侧栏时间按钮携带 transcript videoId/sessionId，后台透传，内容脚本校验后再 seek**

```javascript {.line-numbers}
await request({
  type: "SEEK_VIDEO",
  seconds,
  sessionId: button.dataset.sessionId,
  videoId: button.dataset.videoId,
});
```

- [ ] **Step 4: 在 ACTIVE_CONTEXT_CHANGED/TAB_LOAD_COMPLETE 到达时立即清空并禁用旧字幕，再决定是否延迟列表刷新**

```javascript {.line-numbers}
if (["ACTIVE_CONTEXT_CHANGED", "TAB_LOAD_COMPLETE"].includes(message.type)) {
  resetFullTranscript();
}
```

- [ ] **Step 5: 运行跳转、侧栏刷新与字幕测试至通过并提交**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/video-command-context.test.js tests/sidepanel-scope.test.js tests/sidepanel-transcript-ui.test.js
git add src/core/video-command-context.js src/content.js src/background.js src/sidepanel.js tests/video-command-context.test.js tests/sidepanel-transcript-ui.test.js
git commit -m "修复: 阻止旧字幕跳转新视频"
```

### Task 5: 版本、发布验证、复审与合并

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/STORE_LISTING.md`
- Modify: `docs/index.html`
- Modify: `docs/en/index.html`
- Modify: `tests/manifest.test.js`
- Modify: `tests/release-package.test.js`
- Modify: `docs/superpowers/plans/2026-09-01-pr1-transcript-hardening.md`

**Interfaces:**
- Produces: 可核验的 `artifacts/video-notes-edge-1.0.16.zip` 和同名 `.sha256`。

- [ ] **Step 1: 把所有当前发布版本引用同步为 1.0.16，并把验收文档测试数更新为最终实测值**

```bash {.line-numbers}
rg -n "1\.0\.15|video-notes-edge-1\.0\.15" manifest.json package.json package-lock.json README.md README.zh-CN.md docs tests
```

- [ ] **Step 2: 运行最新全量验证**

```bash {.line-numbers}
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-1.0.16.zip
cd artifacts && shasum -a 256 -c video-notes-edge-1.0.16.zip.sha256
git diff --check origin/main...HEAD
```

- [ ] **Step 3: 在实际浏览器中复核完整字幕窄侧栏布局；无法验证的权限/API 实机路径保留为限制，不改写为已完成**

- [ ] **Step 4: 请求独立代码复审，阻断级问题为零后提交版本与文档**

```bash {.line-numbers}
git add manifest.json package.json package-lock.json README.md README.zh-CN.md docs tests/manifest.test.js tests/release-package.test.js
git commit -m "更新: 发布 1.0.16 完整字幕修复版"
```

- [ ] **Step 5: 推送分支，确认 GitHub 合并状态，再合并 PR #1 并核验 main SHA**

```bash {.line-numbers}
git push origin codex/youtube-full-transcript-spike
gh pr view 1 --repo IronUnicorn66/video-notes --json mergeable,mergeStateStatus,headRefOid
gh pr merge 1 --repo IronUnicorn66/video-notes --merge --delete-branch=false
gh pr view 1 --repo IronUnicorn66/video-notes --json state,mergedAt,mergeCommit
```
