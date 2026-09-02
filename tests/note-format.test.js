import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarkdown,
  formatTimestamp,
  makeExportFilenames,
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
        transcriptionRuns: [
          { modelId: "base-q5_1", text: "第一版文本", source: "automatic", createdAt: 100 },
          { modelId: "small-q5_1", text: "第二版文本", source: "manual", createdAt: 200 },
        ],
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
  assert.ok(markdown.indexOf("我的 **重点**") < markdown.indexOf("本地转写结果"));
  assert.match(markdown, /<details>\n<summary>本地转写结果（2 次转写）<\/summary>/);
  assert.match(markdown, /- Base · 57 MiB：第一版文本/);
  assert.match(markdown, /- Small · 181 MiB：第二版文本/);
  assert.doesNotMatch(markdown, /语音转写候选/);
  assert.doesNotMatch(markdown, /候选文本/);
});

test("旧版候选转写在没有历史时仍会导出", () => {
  const markdown = buildMarkdown(
    { title: "课程", canonicalUrl: "https://example.com", platform: "youtube" },
    [{
      seconds: 1,
      jumpUrl: "https://example.com?t=1",
      body: "我的笔记",
      transcriptCandidate: "旧版候选文本",
      warnings: [],
    }],
  );

  assert.match(markdown, /<summary>语音转写候选<\/summary>/);
  assert.match(markdown, /旧版候选文本/);
});

test("转写历史的多行文本不会破坏 details 结构", () => {
  const markdown = buildMarkdown(
    { title: "课程", canonicalUrl: "https://example.com", platform: "youtube" },
    [{
      seconds: 1,
      jumpUrl: "https://example.com?t=1",
      transcriptionRuns: [{
        modelId: "base-q5_1",
        text: "第一行\n- 列表项\n</details>\n最后一行",
        source: "automatic",
        createdAt: 100,
      }],
      warnings: [],
    }],
  );

  assert.match(markdown, /- Base · 57 MiB：第一行\n  - 列表项\n  &lt;\/details&gt;\n  最后一行/);
  assert.equal((markdown.match(/<\/details>/g) ?? []).length, 1);
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

test("英文导出翻译固定标签并保留用户内容", () => {
  const markdown = buildMarkdown(
    { title: "课程标题", canonicalUrl: "https://example.com", platform: "youtube" },
    [{
      seconds: 1,
      jumpUrl: "https://example.com?t=1",
      body: "用户笔记",
      subtitleContext: "字幕原文",
      audioFilename: "audio/001.webm",
      warnings: ["背景音未联动静音", "转写失败：原始录音已丢失"],
    }],
    { language: "en" },
  );

  assert.match(markdown, /- Platform: youtube/);
  assert.match(markdown, /- Original URL: \[Open video\]/);
  assert.match(markdown, /\[Original recording\]/);
  assert.match(markdown, /### Lead-in subtitles/);
  assert.match(markdown, /> ⚠ Background audio could not be muted automatically/);
  assert.match(markdown, /> ⚠ Transcription failed: The original recording is missing/);
  assert.match(markdown, /用户笔记/);
  assert.match(markdown, /字幕原文/);
});

test("Markdown 将本地字幕原文和译文分别导出", () => {
  const markdown = buildMarkdown(
    { title: "课程", canonicalUrl: "https://example.com", platform: "youtube" },
    [{
      seconds: 1,
      jumpUrl: "https://example.com?t=1",
      body: "笔记",
      subtitleContext: "Original subtitle",
      subtitleTranslation: "字幕译文",
      warnings: [],
    }],
  );

  assert.match(markdown, /### 前置字幕/);
  assert.match(markdown, /#### 原文\n\n> Original subtitle/);
  assert.match(markdown, /#### 译文\n\n> 字幕译文/);
});

test("导出文件名使用当前界面语言并提供空标题回退", () => {
  assert.deepEqual(makeExportFilenames("课程", "zh_CN"), {
    markdown: "课程.md",
    archive: "课程-视频笔记.zip",
  });
  assert.deepEqual(makeExportFilenames("Course", "en"), {
    markdown: "Course.md",
    archive: "Course-video-notes.zip",
  });
  assert.deepEqual(makeExportFilenames("", "en"), {
    markdown: "Video Notes.md",
    archive: "Video Notes-video-notes.zip",
  });
});
