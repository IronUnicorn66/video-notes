import assert from "node:assert/strict";
import test from "node:test";

import { seekMediaForVideoContext } from "../src/core/video-command-context.js";

test("旧字幕不能跳转新视频", () => {
  const media = { currentTime: 12, duration: 100 };

  assert.throws(() => seekMediaForVideoContext({
    media,
    context: { sessionId: "youtube:new", videoId: "new" },
    expectedSessionId: "youtube:old",
    expectedVideoId: "old",
    seconds: 42,
  }), /当前页面会话不匹配/);
  assert.equal(media.currentTime, 12);
});

test("当前字幕按播放器时长跳转并返回实际秒数", () => {
  const media = { currentTime: 12, duration: 100 };

  const seconds = seekMediaForVideoContext({
    media,
    context: { sessionId: "youtube:current", videoId: "current" },
    expectedSessionId: "youtube:current",
    expectedVideoId: "current",
    seconds: 142,
  });

  assert.equal(seconds, 100);
  assert.equal(media.currentTime, 100);
});

test("跳转拒绝缺少播放器和非法时间", () => {
  const context = { sessionId: "youtube:current", videoId: "current" };
  assert.throws(() => seekMediaForVideoContext({
    media: null,
    context,
    expectedSessionId: context.sessionId,
    expectedVideoId: context.videoId,
    seconds: 10,
  }), /没有找到可用的视频播放器/);
  assert.throws(() => seekMediaForVideoContext({
    media: { currentTime: 0, duration: 100 },
    context,
    expectedSessionId: context.sessionId,
    expectedVideoId: context.videoId,
    seconds: -1,
  }), /无效的视频时间点/);
});
