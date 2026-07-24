import assert from "node:assert/strict";
import test from "node:test";

import { computeScreenshotCrop } from "../src/core/screenshot.js";

test("按截图与页面实际比例裁剪并限制最长边", () => {
  assert.deepEqual(
    computeScreenshotCrop(
      { x: 100, y: 50, width: 1000, height: 600 },
      { width: 1440, height: 900 },
      { width: 2880, height: 1800 },
      1600,
    ),
    {
      sx: 200,
      sy: 100,
      sw: 2000,
      sh: 1200,
      outputWidth: 1600,
      outputHeight: 960,
    },
  );
});

test("播放器边界被视口裁切时不会越过截图", () => {
  assert.deepEqual(
    computeScreenshotCrop(
      { x: -50, y: 800, width: 500, height: 300 },
      { width: 1000, height: 1000 },
      { width: 1000, height: 1000 },
      1600,
    ),
    {
      sx: 0,
      sy: 800,
      sw: 450,
      sh: 200,
      outputWidth: 450,
      outputHeight: 200,
    },
  );
});
