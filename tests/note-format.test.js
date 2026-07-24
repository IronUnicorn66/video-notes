import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarkdown,
  formatTimestamp,
  makeAssetFilename,
  sanitizeFilename,
} from "../src/core/note-format.js";

test("格式化时点和稳定资产名", () => {
  assert.equal(formatTimestamp(45296), "12:34:56");
  assert.equal(makeAssetFilename(1, 45296, "webp"), "001_12-34-56.webp");
  assert.equal(sanitizeFilename("A/B: C?"), "A-B- C");
});

test("Markdown 以个人内容优先并使用相对资产链接", () => {
  const markdown = buildMarkdown(
    {
      title: "测试 # 课程",
      canonicalUrl: "https://example.com/watch?v=1",
      platform: "youtube",
    },
    [
      {
        seconds: 12,
        jumpUrl: "https://example.com/watch?v=1&t=12s",
        body: "我的 **重点**",
        transcriptCandidate: "候选文本",
        subtitleContext: "老师原话",
        imageFilename: "images/001_00-00-12.webp",
        audioFilename: "audio/001_00-00-12.webm",
        warnings: [],
      },
    ],
  );

  assert.match(markdown, /^# 测试 \\# 课程/m);
  assert.ok(markdown.indexOf("我的 **重点**") < markdown.indexOf("老师原话"));
  assert.match(markdown, /\[00:00:12\]\(https:\/\/example\.com\/watch\?v=1&t=12s\)/);
  assert.match(markdown, /!\[00:00:12 截图\]\(images\/001_00-00-12\.webp\)/);
  assert.match(markdown, /\[原始录音\]\(audio\/001_00-00-12\.webm\)/);
});

test("缺失资产时省略对应块并保留告警", () => {
  const markdown = buildMarkdown(
    { title: "课程", canonicalUrl: "https://example.com", platform: "bilibili" },
    [{ seconds: 1, jumpUrl: "https://example.com?t=1", body: "笔记", warnings: ["截图失败"] }],
  );

  assert.doesNotMatch(markdown, /截图\]\(/);
  assert.doesNotMatch(markdown, /原始录音/);
  assert.match(markdown, /> ⚠ 截图失败/);
});
