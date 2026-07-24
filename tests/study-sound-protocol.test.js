import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NOTE_HOLD_PROTOCOL_VERSION,
  NOTE_HOLD_TIMEOUT_MS,
  STUDY_SOUND_EXTENSION_ID,
  VIDEO_NOTES_EXTENSION_ID,
  noteHoldMessage,
} from "../src/core/study-sound-protocol.js";

test("网课声伴协议使用固定扩展 ID 和版本", () => {
  assert.match(VIDEO_NOTES_EXTENSION_ID, /^[a-p]{32}$/);
  assert.match(STUDY_SOUND_EXTENSION_ID, /^[a-p]{32}$/);
  assert.equal(NOTE_HOLD_PROTOCOL_VERSION, 1);
});

test("开发环境公钥生成的视频笔记 ID 与互信协议一致", async () => {
  const extensionId = (key) => [...createHash("sha256")
    .update(Buffer.from(key, "base64"))
    .digest()
    .subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");
  const videoManifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(extensionId(videoManifest.key), VIDEO_NOTES_EXTENSION_ID);
});

test("租约消息只携带播放协调所需字段", () => {
  assert.deepEqual(
    noteHoldMessage("NOTE_HOLD_ACQUIRE", {
      leaseId: "note-1",
      tabId: 42,
      shouldResumeMain: true,
    }),
    {
      type: "NOTE_HOLD_ACQUIRE",
      protocolVersion: 1,
      leaseId: "note-1",
      tabId: 42,
      timeoutMs: NOTE_HOLD_TIMEOUT_MS,
      shouldResumeMain: true,
    },
  );
});
