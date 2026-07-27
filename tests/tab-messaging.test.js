import assert from "node:assert/strict";
import test from "node:test";

import { createTabMessenger } from "../src/core/tab-messaging.js";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
      async executeScript(options) {
        injections.push(options);
      },
    },
  });

  const response = await messenger.send(42, { type: "GET_PAGE_CONTEXT" });

  assert.deepEqual(response, { ok: true, context: { videoId: "video-1" } });
  assert.equal(sends, 2);
  assert.deepEqual(injections, [{ target: { tabId: 42 }, files: ["content.js"] }]);
});

test("首次发送成功时不注入内容脚本", async () => {
  let injections = 0;
  const messenger = createTabMessenger({
    tabs: {
      async sendMessage() {
        return { ok: true };
      },
    },
    scripting: {
      async executeScript() {
        injections += 1;
      },
    },
  });

  assert.deepEqual(await messenger.send(7, { type: "PING" }), { ok: true });
  assert.equal(injections, 0);
});

test("非接收端缺失错误直接传播", async () => {
  const expected = new Error("The tab was closed.");
  let injections = 0;
  const messenger = createTabMessenger({
    tabs: {
      async sendMessage() {
        throw expected;
      },
    },
    scripting: {
      async executeScript() {
        injections += 1;
      },
    },
  });

  await assert.rejects(() => messenger.send(7, { type: "PING" }), expected);
  assert.equal(injections, 0);
});

test("同一标签页的并发恢复共用一次注入", async () => {
  const injectionGate = deferred();
  const injectionStarted = deferred();
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
        injectionStarted.resolve();
        await injectionGate.promise;
      },
    },
  });

  const first = messenger.send(42, { type: "FIRST" });
  const second = messenger.send(42, { type: "SECOND" });
  await injectionStarted.promise;
  assert.equal(injections, 1);
  injectionGate.resolve();

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
    scripting: {
      async executeScript() {
        injections += 1;
      },
    },
  });

  await assert.rejects(() => messenger.send(42, { type: "PING" }), /Receiving end/);
  assert.equal(sends, 2);
  assert.equal(injections, 1);
});
