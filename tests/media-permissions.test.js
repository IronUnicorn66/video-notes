import assert from "node:assert/strict";
import test from "node:test";

import {
  friendlyCaptureError,
} from "../src/core/media-permissions.js";

test("把 Edge 的截图权限错误改成可操作提示", () => {
  assert.equal(
    friendlyCaptureError(new Error("Either the '<all_urls>' or 'activeTab' permission is required.")),
    "请在侧栏的权限设置中启用播放器截图",
  );
  assert.equal(friendlyCaptureError(new Error("图像解码失败")), "图像解码失败");
});
