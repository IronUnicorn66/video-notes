# 内容脚本连接自愈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展重载后自动恢复视频标签页的内容脚本连接，让快速标记无需刷新页面即可使用。

**Architecture:** 新增可注入浏览器 API 的标签页消息模块。首次发送遇到接收端缺失时，该模块按标签页合并 `content.js` 注入任务并单次重试；后台保留现有响应校验，只替换底层发送调用。

**Tech Stack:** JavaScript ES modules、Chrome Extensions Manifest V3、Node.js test runner、esbuild

## Global Constraints

- 只恢复包含 `Receiving end does not exist` 的接收端缺失错误。
- 每条消息最多重试一次，同一标签页的并发恢复只注入一次。
- 不修改权限清单、消息格式、侧栏界面、存储格式和内容脚本声明。

---

### Task 1: 标签页消息自愈与后台接线

**Files:**
- Create: `src/core/tab-messaging.js`
- Create: `tests/tab-messaging.test.js`
- Modify: `src/background.js:1-190`
- Modify: `docs/ACCEPTANCE.md:24-48`

**Interfaces:**
- Consumes: `chrome.tabs.sendMessage(tabId, message)`、`chrome.scripting.executeScript(options)`
- Produces: `createTabMessenger({ tabs, scripting, contentScript }).send(tabId, message)`、`isMissingTabReceiverError(error)`

- [ ] **Step 1: Write the failing recovery test**

```javascript {.line-numbers}
test("接收端缺失时注入内容脚本并重试原消息", async () => {
  let sends = 0;
  const injections = [];
  const messenger = createTabMessenger({
    tabs: {
      async sendMessage() {
        sends += 1;
        if (sends === 1) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }
        return { ok: true, context: { videoId: "video-1" } };
      },
    },
    scripting: {
      async executeScript(options) { injections.push(options); },
    },
  });

  const response = await messenger.send(42, { type: "GET_PAGE_CONTEXT" });

  assert.deepEqual(response, { ok: true, context: { videoId: "video-1" } });
  assert.equal(sends, 2);
  assert.deepEqual(injections, [{ target: { tabId: 42 }, files: ["content.js"] }]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/tab-messaging.test.js`

Expected: FAIL because `src/core/tab-messaging.js` does not exist.

- [ ] **Step 3: Implement the minimal self-healing messenger**

```javascript {.line-numbers}
export function isMissingTabReceiverError(error) {
  return String(error?.message ?? error).includes("Receiving end does not exist");
}

export function createTabMessenger({ tabs, scripting, contentScript = "content.js" }) {
  const pendingInjections = new Map();

  async function ensureContentScript(tabId) {
    let injection = pendingInjections.get(tabId);
    if (!injection) {
      injection = Promise.resolve().then(() => scripting.executeScript({
        target: { tabId },
        files: [contentScript],
      }));
      pendingInjections.set(tabId, injection);
    }
    try {
      await injection;
    } finally {
      if (pendingInjections.get(tabId) === injection) pendingInjections.delete(tabId);
    }
  }

  return {
    async send(tabId, message) {
      try {
        return await tabs.sendMessage(tabId, message);
      } catch (error) {
        if (!isMissingTabReceiverError(error)) throw error;
        await ensureContentScript(tabId);
        return tabs.sendMessage(tabId, message);
      }
    },
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/tab-messaging.test.js`

Expected: PASS.

- [ ] **Step 5: Add concurrency and error-boundary tests**

```javascript {.line-numbers}
function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("首次发送成功时不注入内容脚本", async () => {
  let injections = 0;
  const messenger = createTabMessenger({
    tabs: { async sendMessage() { return { ok: true }; } },
    scripting: { async executeScript() { injections += 1; } },
  });

  assert.deepEqual(await messenger.send(7, { type: "PING" }), { ok: true });
  assert.equal(injections, 0);
});

test("非接收端缺失错误直接传播", async () => {
  const expected = new Error("The tab was closed.");
  let injections = 0;
  const messenger = createTabMessenger({
    tabs: { async sendMessage() { throw expected; } },
    scripting: { async executeScript() { injections += 1; } },
  });

  await assert.rejects(() => messenger.send(7, { type: "PING" }), expected);
  assert.equal(injections, 0);
});

test("同一标签页的并发恢复共用一次注入", async () => {
  const gate = deferred();
  const started = deferred();
  const attempts = new Map();
  let injections = 0;
  const messenger = createTabMessenger({
    tabs: {
      async sendMessage(_tabId, message) {
        const count = (attempts.get(message.type) ?? 0) + 1;
        attempts.set(message.type, count);
        if (count === 1) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }
        return { ok: true, type: message.type };
      },
    },
    scripting: {
      async executeScript() {
        injections += 1;
        started.resolve();
        await gate.promise;
      },
    },
  });

  const first = messenger.send(42, { type: "FIRST" });
  const second = messenger.send(42, { type: "SECOND" });
  await started.promise;
  assert.equal(injections, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [
    { ok: true, type: "FIRST" },
    { ok: true, type: "SECOND" },
  ]);
});

test("失败的注入会清理状态并允许后续恢复", async () => {
  let sends = 0;
  let injections = 0;
  const messenger = createTabMessenger({
    tabs: {
      async sendMessage() {
        sends += 1;
        if (sends < 3) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }
        return { ok: true };
      },
    },
    scripting: {
      async executeScript() {
        injections += 1;
        if (injections === 1) throw new Error("注入失败");
      },
    },
  });

  await assert.rejects(() => messenger.send(42, { type: "FIRST" }), /注入失败/);
  assert.deepEqual(await messenger.send(42, { type: "SECOND" }), { ok: true });
  assert.equal(injections, 2);
});

test("注入后的重试失败时不重复注入", async () => {
  let sends = 0;
  let injections = 0;
  const messenger = createTabMessenger({
    tabs: {
      async sendMessage() {
        sends += 1;
        throw new Error("Could not establish connection. Receiving end does not exist.");
      },
    },
    scripting: { async executeScript() { injections += 1; } },
  });

  await assert.rejects(() => messenger.send(42, { type: "PING" }), /Receiving end/);
  assert.equal(sends, 2);
  assert.equal(injections, 1);
});
```

- [ ] **Step 6: Run the focused tests**

Run: `node --test tests/tab-messaging.test.js`

Expected: all focused tests PASS.

- [ ] **Step 7: Wire the messenger into the background**

Import `createTabMessenger`, initialize it with `chrome.tabs` and `chrome.scripting`, then change the existing `sendToTab()` to call `tabMessenger.send(tabId, message)` before its current `{ ok }` response validation.

- [ ] **Step 8: Add manual acceptance coverage**

Add an unchecked item under “笔记资产与侧栏”：keep a supported video tab open, reload the extension, open the side panel without refreshing the video, and confirm the title and quick-marker input recover and can pause/save/cancel normally.

- [ ] **Step 9: Verify the complete change**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: build exits with status 0 and produces `dist/background.js` and `dist/content.js`.

- [ ] **Step 10: Commit**

```bash {.line-numbers}
git add src/core/tab-messaging.js tests/tab-messaging.test.js src/background.js docs/ACCEPTANCE.md docs/superpowers/plans/2026-07-27-content-script-recovery.md
git commit -m "修复: 自动恢复视频页面消息连接"
```
