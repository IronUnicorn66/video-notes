import assert from "node:assert/strict";
import test from "node:test";

const microphoneAccess = await import("../src/core/microphone-access.js").catch(() => ({}));

test("麦克风授权探测完成后立即关闭所有轨道", async () => {
  assert.equal(typeof microphoneAccess.verifyMicrophoneAccess, "function");
  const stopped = [];
  const stream = {
    getTracks() {
      return [
        { stop: () => stopped.push("left") },
        { stop: () => stopped.push("right") },
      ];
    },
  };

  const result = await microphoneAccess.verifyMicrophoneAccess(async (constraints) => {
    assert.equal(constraints.audio.channelCount, 1);
    return stream;
  });

  assert.equal(result, true);
  assert.deepEqual(stopped, ["left", "right"]);
});
