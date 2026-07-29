import assert from "node:assert/strict";
import test from "node:test";

import { reportWhisperRuntimeMessage } from "../src/core/whisper-log.js";

function captureRuntimeMessage(message) {
  const entries = [];
  reportWhisperRuntimeMessage(message, {
    debug: (...args) => entries.push(["debug", ...args]),
    error: (...args) => entries.push(["error", ...args]),
  });
  return entries;
}

test("Whisper 初始化信息只进入调试日志", () => {
  assert.deepEqual(
    captureRuntimeMessage("whisper_model_load: n_vocab = 51865"),
    [["debug", "Whisper", "whisper_model_load: n_vocab = 51865"]],
  );
});

test("Whisper 失败信息继续进入错误日志", () => {
  for (const message of [
    "failed to load model",
    "error while decoding audio",
    "Aborted(out of memory)",
    "runtime exception",
  ]) {
    assert.deepEqual(
      captureRuntimeMessage(message),
      [["error", "Whisper", message]],
    );
  }
});
