import assert from "node:assert/strict";
import test from "node:test";

import {
  SUBTITLE_WINDOW_OPTIONS,
  SubtitleCapture,
  normalizeSubtitleSettings,
} from "../src/core/subtitle-capture.js";

test("字幕设置默认开启并使用 20 秒固定范围", () => {
  assert.deepEqual(normalizeSubtitleSettings({}), {
    enabled: true,
    windowSeconds: 20,
  });
  assert.deepEqual(SUBTITLE_WINDOW_OPTIONS, [5, 10, 20, 30]);
});

test("字幕设置只接受四个固定范围", () => {
  for (const windowSeconds of [5, 10, 20, 30]) {
    assert.deepEqual(normalizeSubtitleSettings({
      subtitleEnabled: false,
      subtitleWindowSeconds: windowSeconds,
    }), {
      enabled: false,
      windowSeconds,
    });
  }

  for (const subtitleWindowSeconds of [0, 15, 31, "20", null]) {
    assert.equal(
      normalizeSubtitleSettings({ subtitleWindowSeconds }).windowSeconds,
      20,
    );
  }
});

test("字幕采集按当前固定范围截取标记前内容", () => {
  const expected = new Map([
    [5, "最近"],
    [10, "较近\n最近"],
    [20, "中段\n较近\n最近"],
    [30, "较远\n中段\n较近\n最近"],
  ]);

  for (const [windowSeconds, text] of expected) {
    const capture = new SubtitleCapture({
      subtitleEnabled: true,
      subtitleWindowSeconds: windowSeconds,
    });
    capture.add(9, "范围外");
    capture.add(19, "较远");
    capture.add(29, "中段");
    capture.add(34, "较近");
    capture.add(36, "最近");

    assert.equal(capture.before(40), text);
  }
});

test("关闭字幕会清空未保存缓冲并忽略关闭期间内容", () => {
  const capture = new SubtitleCapture();
  capture.add(10, "关闭前");

  capture.updateSettings({ subtitleEnabled: false });
  capture.add(11, "关闭期间");
  assert.equal(capture.before(12), "");

  capture.updateSettings({ subtitleEnabled: true });
  capture.add(12, "重新开启");
  assert.equal(capture.before(13), "重新开启");
});
