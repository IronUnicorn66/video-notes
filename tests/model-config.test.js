import assert from "node:assert/strict";
import test from "node:test";

import { WHISPER_MODEL } from "../src/core/model-config.js";

test("Whisper 模型固定版本、大小与 SHA-256", () => {
  assert.equal(WHISPER_MODEL.id, "base-q5_1");
  assert.equal(WHISPER_MODEL.size, 59_707_625);
  assert.equal(
    WHISPER_MODEL.sha256,
    "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
  );
  assert.match(WHISPER_MODEL.url, /\/resolve\/[0-9a-f]{40}\//);
});
