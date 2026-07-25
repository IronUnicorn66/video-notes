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
