# Player Click Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户写完笔记后第一次点击已暂停的播放器即可续播，同时完成笔记自动保存。

**Architecture:** 在播放租约核心模块中增加“播放器按下接管播放”的纯函数，并由内容脚本的捕获阶段 `pointerdown` 调用。该函数只在按下目标属于播放器时标记用户干预，使笔记提交后的租约释放跳过自动 `play()`，让网站播放器处理同一次点击。

**Tech Stack:** JavaScript ES modules、Node.js 内置测试运行器、Manifest V3、esbuild。

## Global Constraints

- 本次发布版本固定为 `1.0.2`。
- 只修改播放器点击续播、对应测试、版本元数据和当前发布文档。
- 保留点击侧栏其他位置或快捷键提交后的现有自动恢复规则。
- 所有 commit 消息使用简体中文，格式为 `<类型>: <简短描述>`。

---

### Task 1: 播放器点击接管播放租约

**Files:**
- Modify: `tests/playback-lease.test.js`
- Modify: `src/core/playback-lease.js`
- Modify: `src/content.js`

**Interfaces:**
- Consumes: `markPlaybackIntervention(lease, action, now)` 和播放器元素的 `contains(target)`。
- Produces: `markPlayerPointerIntervention(lease, player, target, now)`，返回原租约或已标记用户干预的新租约。

- [x] **Step 1: Write the failing tests**

在 `tests/playback-lease.test.js` 增加两个行为测试：播放器内按下后释放租约不得自动播放；播放器外按下仍保留自动播放资格。

```javascript {.line-numbers}
test("播放器按下会把续播交给网站播放器", () => {
  const target = {};
  const player = { contains: (candidate) => candidate === target };
  const lease = acquirePlaybackLease({ paused: false }, { now: 100 });
  const intervened = markPlayerPointerIntervention(lease, player, target, 150);
  assert.deepEqual(releasePlaybackLease(intervened, { paused: true }, 200), {
    shouldPlay: false,
    reason: "user-intervened",
  });
});

test("播放器外按下不影响扩展自动续播", () => {
  const player = { contains: () => false };
  const lease = acquirePlaybackLease({ paused: false }, { now: 100 });
  const unchanged = markPlayerPointerIntervention(lease, player, {}, 150);
  assert.equal(releasePlaybackLease(unchanged, { paused: true }, 200).shouldPlay, true);
});
```

- [x] **Step 2: Run the focused test and verify RED**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/playback-lease.test.js
```

预期：因 `markPlayerPointerIntervention` 尚未导出而失败。

- [x] **Step 3: Implement the minimal lease helper**

在 `src/core/playback-lease.js` 增加仅检查活动租约与播放器包含关系的函数。

```javascript {.line-numbers}
export function markPlayerPointerIntervention(lease, player, target, now = Date.now()) {
  if (!lease || !player?.contains(target)) return lease;
  return markPlaybackIntervention(lease, "player-pointerdown", now);
}
```

- [x] **Step 4: Connect the content-script pointer event**

在 `src/content.js` 导入新函数，并在捕获阶段监听 `pointerdown`。存在活动租约且播放器可识别时，用新函数更新租约；不阻止网站原生事件。

- [x] **Step 5: Run the focused test and verify GREEN**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/playback-lease.test.js
```

预期：播放租约测试全部通过。

### Task 2: 升级版本并完成发布验证

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/manifest.test.js`
- Modify: `tests/release-package.test.js`
- Modify: `tests/site.test.js`
- Modify: `README.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/STORE_LISTING.md`
- Modify: `docs/index.html`

**Interfaces:**
- Consumes: Task 1 的播放器点击行为。
- Produces: 版本一致的 `1.0.2` 构建目录和发布 ZIP。

- [x] **Step 1: Update version expectations to `1.0.2` and verify RED**

先把发布测试中的预期版本及包名改为 `1.0.2`，运行相关测试，确认旧元数据导致失败。

```bash {.line-numbers}
node --test --test-concurrency=1 tests/manifest.test.js tests/release-package.test.js
```

- [x] **Step 2: Synchronize metadata and current release documentation**

将 Manifest、package 元数据、锁文件根包版本、README、验收清单、商店说明和官网当前下载版本统一改为 `1.0.2`。

- [x] **Step 3: Run full automated verification**

```bash {.line-numbers}
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-1.0.2.zip
```

预期：测试零失败，构建及打包退出码为 0，ZIP 完整性校验通过。

- [x] **Step 4: Inspect the final diff and commit**

确认改动只覆盖本计划后提交。

```bash {.line-numbers}
git add src/core/playback-lease.js src/content.js tests/playback-lease.test.js manifest.json package.json package-lock.json tests/manifest.test.js tests/release-package.test.js tests/site.test.js README.md docs/ACCEPTANCE.md docs/STORE_LISTING.md docs/index.html docs/superpowers/specs/2026-07-29-player-click-resume-design.md docs/superpowers/plans/2026-07-29-player-click-resume.md
git commit -m "修复: 优化播放器单击续播并升级至 1.0.2"
```

## Self-Review

- Spec coverage: 播放器单击续播、自动保存保持、非播放器操作不变、版本升级和发布验证均有对应步骤。
- Placeholder scan: 计划不包含占位步骤。
- Type consistency: 核心模块导出的 `markPlayerPointerIntervention` 与内容脚本、测试使用的参数顺序一致。
