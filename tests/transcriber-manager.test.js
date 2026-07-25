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
