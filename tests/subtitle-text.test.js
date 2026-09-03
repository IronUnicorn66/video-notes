import assert from "node:assert/strict";
import test from "node:test";

import { readRenderedSubtitleText } from "../src/core/subtitle-text.js";

function subtitleNode(text, { visible = true, children = {} } = {}) {
  return {
    textContent: text,
    getClientRects: () => visible ? [{}] : [],
    querySelectorAll: (selector) => children[selector] ?? [],
  };
}

function subtitleRoot(nodes) {
  return {
    querySelectorAll: (selector) => nodes[selector] ?? [],
  };
}

function nodeList(nodes) {
  return {
    *[Symbol.iterator]() {
      yield* nodes;
    },
  };
}

test("沉浸式翻译字幕保留双语两行并忽略原生字幕", () => {
  const root = subtitleRoot({
    ".imt-captions-text": [subtitleNode("", {
      children: {
        ".source-cue, .target-cue": [
          subtitleNode(" children starting school this year will be retiring in 2065. "),
          subtitleNode(" 今年入学的孩子们将在 2065 年退休。 "),
        ],
      },
    })],
    ".ytp-caption-segment": [subtitleNode("native subtitle")],
  });

  assert.equal(
    readRenderedSubtitleText(root, "youtube"),
    "children starting school this year will be retiring in 2065.\n今年入学的孩子们将在 2065 年退休。",
  );
});

test("沉浸式翻译字幕读取可迭代 NodeList 风格提示节点", () => {
  const root = subtitleRoot({
    ".imt-captions-text": [subtitleNode("", {
      children: {
        ".source-cue, .target-cue": nodeList([
          subtitleNode("source cue"),
          subtitleNode("target cue"),
        ]),
      },
    })],
  });

  assert.equal(readRenderedSubtitleText(root, "youtube"), "source cue\ntarget cue");
});

test("沉浸式翻译字幕可从字幕宿主的开放 Shadow DOM 读取", () => {
  const shadowRoot = subtitleRoot({
    ".imt-captions-text": [subtitleNode("", {
      children: {
        ".source-cue, .target-cue": [
          subtitleNode("Now, we go back to main."),
          subtitleNode("现在，我们回到主界面。"),
        ],
      },
    })],
  });
  const host = subtitleNode("");
  host.shadowRoot = shadowRoot;
  const root = subtitleRoot({
    "#immersive-translate-caption-window": [host],
  });

  assert.equal(
    readRenderedSubtitleText(root, "youtube"),
    "Now, we go back to main.\n现在，我们回到主界面。",
  );
});

test("沉浸式翻译字幕为空时回退到平台原生字幕", () => {
  const root = subtitleRoot({
    ".imt-captions-text": [subtitleNode("", {
      children: { ".source-cue, .target-cue": [subtitleNode("   ")] },
    })],
    ".bili-subtitle-x-subtitle-panel-text, .bpx-player-subtitle-panel-text, .bilibili-player-video-subtitle": [
      subtitleNode("  哔哩哔哩原生字幕  "),
    ],
  });

  assert.equal(readRenderedSubtitleText(root, "bilibili"), "哔哩哔哩原生字幕");
});

test("读取 B 站新版播放器的原生字幕节点", () => {
  const root = subtitleRoot({
    ".bili-subtitle-x-subtitle-panel-text, .bpx-player-subtitle-panel-text, .bilibili-player-video-subtitle": [
      subtitleNode("  新版 B 站字幕  "),
    ],
  });

  assert.equal(readRenderedSubtitleText(root, "bilibili"), "新版 B 站字幕");
});

test("沉浸式翻译字幕不可见时回退到平台原生字幕", () => {
  const root = subtitleRoot({
    ".imt-captions-text": [subtitleNode("", {
      visible: false,
      children: {
        ".source-cue, .target-cue": [subtitleNode("hidden immersive subtitle")],
      },
    })],
    ".ytp-caption-segment": [subtitleNode("YouTube native subtitle")],
  });

  assert.equal(readRenderedSubtitleText(root, "youtube"), "YouTube native subtitle");
});

test("同一字幕来源去除相邻重复文本", () => {
  const root = subtitleRoot({
    ".ytp-caption-segment": [
      subtitleNode("  first segment  "),
      subtitleNode("first segment"),
      subtitleNode("second segment"),
      subtitleNode("first segment"),
    ],
  });

  assert.equal(
    readRenderedSubtitleText(root, "youtube"),
    "first segment second segment first segment",
  );
});
