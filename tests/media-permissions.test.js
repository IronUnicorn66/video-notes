import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseMicrophone,
  friendlyCaptureError,
  friendlyMicrophoneError,
} from "../src/core/media-permissions.js";

test("只有持久状态和浏览器权限都有效时才允许开始录音", () => {
  assert.equal(canUseMicrophone(true, "granted"), true);
  assert.equal(canUseMicrophone(false, "granted"), false);
  assert.equal(canUseMicrophone(true, "prompt"), false);
  assert.equal(canUseMicrophone(true, "denied"), false);
});

test("把 Edge 的截图权限错误改成可操作提示", () => {
  assert.equal(
    friendlyCaptureError(new Error("Either the '<all_urls>' or 'activeTab' permission is required.")),
    "请在侧栏的权限设置中启用播放器截图",
  );
  assert.equal(friendlyCaptureError(new Error("图像解码失败")), "图像解码失败");
});

test("把隐藏页的麦克风拒绝改成可操作提示", () => {
  assert.equal(
    friendlyMicrophoneError(new Error("Permission dismissed")),
    "请先在侧栏的权限设置中授权麦克风",
  );
  assert.equal(
    friendlyMicrophoneError(new DOMException("Permission denied", "NotAllowedError")),
    "请先在侧栏的权限设置中授权麦克风",
  );
  assert.equal(friendlyMicrophoneError(new Error("没有找到输入设备")), "没有找到输入设备");
});
