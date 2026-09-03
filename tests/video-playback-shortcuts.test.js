import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PLAYBACK_COMMAND,
  controlVideoPlayback,
  findPrimaryVideo,
  isReservedVideoPlaybackCode,
  normalizePushToTalkShortcut,
  playbackCommandForKeyEvent,
  shouldExecutePlaybackCommand,
} from "../src/core/video-playback-shortcuts.js";
import { installVideoPageShortcuts } from "../src/core/video-page-shortcuts.js";

function keyEvent(code, overrides = {}) {
  return {
    code,
    target: { tagName: "DIV" },
    ...overrides,
  };
}

function context() {
  return {
    platform: "youtube",
    sessionId: "youtube:current",
    videoId: "current",
  };
}

test("无修饰的左右方向键和空格映射为播放器命令", () => {
  assert.equal(
    playbackCommandForKeyEvent(keyEvent("ArrowLeft")),
    PLAYBACK_COMMAND.SEEK_BACKWARD,
  );
  assert.equal(
    playbackCommandForKeyEvent(keyEvent("ArrowRight")),
    PLAYBACK_COMMAND.SEEK_FORWARD,
  );
  assert.equal(
    playbackCommandForKeyEvent(keyEvent("Space")),
    PLAYBACK_COMMAND.TOGGLE_PLAYBACK,
  );

  for (const code of ["Enter", "KeyK", "Escape"]) {
    assert.equal(playbackCommandForKeyEvent(keyEvent(code)), null);
  }
});

test("修饰键、输入法和已经处理的事件保留原行为", () => {
  for (const overrides of [
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { isComposing: true },
    { defaultPrevented: true },
  ]) {
    assert.equal(playbackCommandForKeyEvent(keyEvent("Space", overrides)), null);
  }
});

test("文字输入区域不拦截，非文字侧栏控件由视频快捷键优先", () => {
  for (const target of [
    { tagName: "TEXTAREA" },
    { tagName: "INPUT", type: "text" },
    { tagName: "INPUT", type: "search" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "DIV", getAttribute: (name) => name === "role" ? "textbox" : null },
    { tagName: "SPAN", closest: (selector) => selector === '[role="textbox"]' ? {} : null },
  ]) {
    assert.equal(playbackCommandForKeyEvent(keyEvent("Space", { target })), null);
  }

  for (const target of [
    { tagName: "BUTTON" },
    { tagName: "SELECT" },
    { tagName: "INPUT", type: "checkbox" },
    { tagName: "INPUT", type: "radio" },
  ]) {
    assert.equal(
      playbackCommandForKeyEvent(keyEvent("Space", { target })),
      PLAYBACK_COMMAND.TOGGLE_PLAYBACK,
    );
  }
});

test("长按方向键持续执行，长按空格只执行第一次", () => {
  assert.equal(
    shouldExecutePlaybackCommand(
      keyEvent("ArrowRight", { repeat: true }),
      PLAYBACK_COMMAND.SEEK_FORWARD,
    ),
    true,
  );
  assert.equal(
    shouldExecutePlaybackCommand(
      keyEvent("Space", { repeat: true }),
      PLAYBACK_COMMAND.TOGGLE_PLAYBACK,
    ),
    false,
  );
  assert.equal(
    shouldExecutePlaybackCommand(
      keyEvent("Space", { repeat: false }),
      PLAYBACK_COMMAND.TOGGLE_PLAYBACK,
    ),
    true,
  );
});

test("优先选择可见面积最大的播放器", () => {
  const small = {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
  };
  const large = {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 200 }),
  };
  const hidden = {
    getBoundingClientRect: () => ({ left: 900, top: 900, right: 1200, bottom: 1200 }),
  };
  const root = { querySelectorAll: () => [small, hidden, large] };

  assert.equal(findPrimaryVideo(root, { width: 800, height: 600 }), large);
});

test("左右方向键按五秒跳转并限制在视频范围内", async () => {
  const media = { currentTime: 3, duration: 100, paused: false };

  assert.deepEqual(await controlVideoPlayback({
    media,
    context: context(),
    expectedSessionId: "youtube:current",
    expectedVideoId: "current",
    command: PLAYBACK_COMMAND.SEEK_BACKWARD,
  }), { seconds: 0, paused: false });

  media.currentTime = 98;
  assert.deepEqual(await controlVideoPlayback({
    media,
    context: context(),
    expectedSessionId: "youtube:current",
    expectedVideoId: "current",
    command: PLAYBACK_COMMAND.SEEK_FORWARD,
  }), { seconds: 100, paused: false });
});

test("空格在播放和暂停状态之间切换", async () => {
  const events = [];
  const media = {
    currentTime: 12,
    duration: 100,
    paused: false,
    pause() {
      events.push("pause");
      this.paused = true;
    },
    async play() {
      events.push("play");
      this.paused = false;
    },
  };

  assert.deepEqual(await controlVideoPlayback({
    media,
    context: context(),
    command: PLAYBACK_COMMAND.TOGGLE_PLAYBACK,
  }), { seconds: 12, paused: true });
  assert.deepEqual(await controlVideoPlayback({
    media,
    context: context(),
    command: PLAYBACK_COMMAND.TOGGLE_PLAYBACK,
  }), { seconds: 12, paused: false });
  assert.deepEqual(events, ["pause", "play"]);
});

test("播放器命令拒绝缺少播放器、旧会话、非法命令和播放失败", async () => {
  await assert.rejects(controlVideoPlayback({
    media: null,
    context: context(),
    command: PLAYBACK_COMMAND.SEEK_FORWARD,
  }), /没有找到可用的视频播放器/);

  await assert.rejects(controlVideoPlayback({
    media: { currentTime: 10, duration: 100, paused: false },
    context: context(),
    expectedSessionId: "youtube:old",
    expectedVideoId: "old",
    command: PLAYBACK_COMMAND.SEEK_FORWARD,
  }), /当前页面会话不匹配/);

  await assert.rejects(controlVideoPlayback({
    media: { currentTime: 10, duration: 100, paused: false },
    context: context(),
    expectedSessionId: "youtube:current",
    command: PLAYBACK_COMMAND.SEEK_FORWARD,
  }), /当前页面会话不匹配/);

  await assert.rejects(controlVideoPlayback({
    media: { currentTime: 10, duration: 100, paused: false },
    context: context(),
    command: "unknown",
  }), /未知的播放器命令/);

  await assert.rejects(controlVideoPlayback({
    media: {
      currentTime: 10,
      duration: 100,
      paused: true,
      play: async () => { throw new Error("autoplay blocked"); },
    },
    context: context(),
    command: PLAYBACK_COMMAND.TOGGLE_PLAYBACK,
  }), /autoplay blocked/);
});

test("空格和左右方向键保留给播放器，冲突的录音键回退到右 Alt", () => {
  for (const code of ["Space", "ArrowLeft", "ArrowRight"]) {
    assert.equal(isReservedVideoPlaybackCode(code), true);
    assert.equal(normalizePushToTalkShortcut(code), "AltRight");
  }
  assert.equal(isReservedVideoPlaybackCode("AltRight"), false);
  assert.equal(normalizePushToTalkShortcut("AltLeft"), "AltLeft");
  assert.equal(normalizePushToTalkShortcut(undefined), "AltRight");
});

test("页面快捷键提前拦截网站处理器且重复安装保持幂等", async () => {
  const listeners = [];
  const eventTarget = {
    addEventListener(type, listener, capture) {
      listeners.push({ type, listener, capture });
    },
  };
  const media = { currentTime: 20, duration: 100, paused: false };
  const root = {
    querySelectorAll: () => [{
      ...media,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 360 }),
      set currentTime(value) { media.currentTime = value; },
      get currentTime() { return media.currentTime; },
      get duration() { return media.duration; },
      get paused() { return media.paused; },
    }],
  };
  const options = {
    eventTarget,
    root,
    getContext: context,
    getViewport: () => ({ width: 800, height: 600 }),
  };

  const first = installVideoPageShortcuts(options);
  const second = installVideoPageShortcuts(options);
  assert.equal(first, second);
  assert.deepEqual(listeners.map(({ type, capture }) => ({ type, capture })), [
    { type: "keydown", capture: true },
    { type: "keyup", capture: true },
  ]);

  let prevented = 0;
  let stopped = 0;
  listeners[0].listener(keyEvent("ArrowRight", {
    preventDefault: () => { prevented += 1; },
    stopImmediatePropagation: () => { stopped += 1; },
  }));
  await Promise.resolve();
  assert.equal(media.currentTime, 25);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);

  listeners[1].listener(keyEvent("ArrowRight", {
    preventDefault: () => { prevented += 1; },
    stopImmediatePropagation: () => { stopped += 1; },
  }));
  assert.equal(media.currentTime, 25);
  assert.equal(prevented, 2);
  assert.equal(stopped, 2);
});

test("页面、侧栏、后台和内容脚本接通同一个播放器命令", async () => {
  const [player, sidepanel, background, content] = await Promise.all([
    readFile(new URL("../src/player-shortcuts.js", import.meta.url), "utf8"),
    readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8"),
    readFile(new URL("../src/background.js", import.meta.url), "utf8"),
    readFile(new URL("../src/content.js", import.meta.url), "utf8"),
  ]);

  assert.match(player, /installVideoPageShortcuts/);
  assert.match(sidepanel, /type: "CONTROL_VIDEO_PLAYBACK"/);
  assert.match(sidepanel, /sessionId: activeContext\.sessionId/);
  assert.match(sidepanel, /videoId: activeContext\.videoId/);
  assert.match(background, /case "CONTROL_VIDEO_PLAYBACK"/);
  assert.match(background, /sidePanelTargetTab\(sender, message\.tabId\)/);
  assert.match(content, /case "CONTROL_VIDEO_PLAYBACK"/);
  assert.match(content, /expectedSessionId: message\.sessionId/);
  assert.match(content, /expectedVideoId: message\.videoId/);
});
