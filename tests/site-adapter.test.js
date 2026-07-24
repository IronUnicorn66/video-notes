import assert from "node:assert/strict";
import test from "node:test";

import {
  buildJumpUrl,
  parseVideoContext,
} from "../src/core/site-adapter.js";

test("解析 YouTube 普通视频并清理跟踪参数", () => {
  const context = parseVideoContext(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=ignored",
    "课程标题",
  );

  assert.deepEqual(context, {
    platform: "youtube",
    sessionId: "youtube:dQw4w9WgXcQ",
    videoId: "dQw4w9WgXcQ",
    part: 1,
    title: "课程标题",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  assert.equal(
    buildJumpUrl(context, 75.9),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s",
  );
});

test("解析哔哩哔哩 BV 与分P", () => {
  const context = parseVideoContext(
    "https://www.bilibili.com/video/BV1xx411c7mD/?p=3&spm_id_from=333",
    "分P课程",
  );

  assert.deepEqual(context, {
    platform: "bilibili",
    sessionId: "bilibili:BV1xx411c7mD:3",
    videoId: "BV1xx411c7mD",
    part: 3,
    title: "分P课程",
    canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=3",
  });
  assert.equal(
    buildJumpUrl(context, 3723.7),
    "https://www.bilibili.com/video/BV1xx411c7mD?p=3&t=3723",
  );
});

test("拒绝非目标页面和无效分P", () => {
  assert.equal(parseVideoContext("https://example.com/video/1"), null);
  const context = parseVideoContext(
    "https://www.bilibili.com/video/BV1xx411c7mD?p=oops",
  );
  assert.equal(context.part, 1);
});

