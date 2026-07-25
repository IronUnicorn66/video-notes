import assert from "node:assert/strict";
import test from "node:test";

import { createWhisperOperationLock } from "../src/core/whisper-operation.js";

test("下载进行中拒绝交错的模型切换", async () => {
  let releaseDownload;
  const downloadStarted = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  const lock = createWhisperOperationLock();
  const download = lock.run(async () => {
    await downloadStarted;
    return "base-q5_1";
  });

  await assert.rejects(
    lock.run(async () => "small-q5_1"),
    /模型操作进行中/,
  );

  releaseDownload();
  assert.equal(await download, "base-q5_1");
  assert.equal(await lock.run(async () => "small-q5_1"), "small-q5_1");
});
