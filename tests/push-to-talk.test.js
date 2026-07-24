import assert from "node:assert/strict";
import test from "node:test";

import {
  PushToTalkController,
  isEditableTarget,
} from "../src/core/push-to-talk.js";

test("只响应指定物理按键并忽略自动重复", async () => {
  const events = [];
  const controller = new PushToTalkController({
    keyCode: "AltRight",
    onStart: async () => events.push("start"),
    onStop: async (reason) => events.push(`stop:${reason}`),
  });

  assert.equal(await controller.keyDown({ code: "AltLeft" }), false);
  assert.equal(await controller.keyDown({ code: "AltRight" }), true);
  assert.equal(await controller.keyDown({ code: "AltRight", repeat: true }), false);
  assert.equal(await controller.keyUp({ code: "AltRight" }), true);
  assert.deepEqual(events, ["start", "stop:keyup"]);
});

test("输入控件内不触发，窗口失焦会强制结束", async () => {
  const events = [];
  const controller = new PushToTalkController({
    onStart: async () => events.push("start"),
    onStop: async (reason) => events.push(`stop:${reason}`),
  });

  assert.equal(isEditableTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(
    await controller.keyDown({ code: "AltRight", target: { tagName: "INPUT" } }),
    false,
  );
  await controller.keyDown({ code: "AltRight", target: { tagName: "DIV" } });
  assert.equal(await controller.forceStop("blur"), true);
  assert.deepEqual(events, ["start", "stop:blur"]);
});

test("开始失败会回到空闲状态", async () => {
  const controller = new PushToTalkController({
    onStart: async () => {
      throw new Error("麦克风拒绝");
    },
    onStop: async () => {},
  });

  await assert.rejects(controller.keyDown({ code: "AltRight" }), /麦克风拒绝/);
  assert.equal(controller.isActive, false);
});

test("后台强制复位不会再次调用停止回调", async () => {
  const events = [];
  const controller = new PushToTalkController({
    onStart: async () => events.push("start"),
    onStop: async () => events.push("stop"),
  });
  await controller.keyDown({ code: "AltRight" });
  assert.equal(controller.reset(), true);
  assert.equal(controller.isActive, false);
  assert.deepEqual(events, ["start"]);
});
