import assert from "node:assert/strict";
import test from "node:test";

import {
  assertModelSwitchAllowed,
  applyTranscript,
  canTranscribeWithWhisper,
  isWhisperModelSwitchBlocked,
  transitionWhisperState,
} from "../src/core/whisper-state.js";

test("Whisper 状态只允许合法迁移", () => {
  assert.equal(transitionWhisperState("disabled", "enable"), "downloading");
  assert.equal(transitionWhisperState("downloading", "downloaded"), "ready");
  assert.equal(transitionWhisperState("ready", "record"), "recording");
  assert.equal(transitionWhisperState("recording", "stop"), "transcribing");
  assert.equal(transitionWhisperState("transcribing", "complete"), "ready");
  assert.throws(() => transitionWhisperState("disabled", "record"), /非法状态迁移/);
});

test("录音、转写或下载期间拒绝切换 Whisper 模型", () => {
  assert.equal(isWhisperModelSwitchBlocked({}), false);
  assert.equal(isWhisperModelSwitchBlocked({ recording: true }), true);
  assert.equal(isWhisperModelSwitchBlocked({ starting: true }), true);
  assert.equal(isWhisperModelSwitchBlocked({ stopping: true }), true);
  assert.equal(isWhisperModelSwitchBlocked({ downloading: true }), true);
  assert.equal(isWhisperModelSwitchBlocked({ transcriptionNoteIds: ["note-1"] }), true);
});

test("空闲状态允许切换模型", () => {
  assert.doesNotThrow(() => assertModelSwitchAllowed({
    whisperState: "ready",
    modelDownloading: false,
    transcriptionCount: 0,
    recording: false,
  }));
});

for (const busyState of [
  { whisperState: "downloading", modelDownloading: true, transcriptionCount: 0, recording: false },
  { whisperState: "recording", modelDownloading: false, transcriptionCount: 0, recording: true },
  { whisperState: "transcribing", modelDownloading: false, transcriptionCount: 1, recording: false },
]) {
  test(`忙碌状态 ${busyState.whisperState} 拒绝切换模型`, () => {
    assert.throws(() => assertModelSwitchAllowed(busyState), /任务结束后再切换/);
  });
}

test("首次语音转写写入正文并记录模型", () => {
  const note = applyTranscript(
    { body: "", userEditVersion: 0, transcriptionRuns: [] },
    "第一版",
    { modelId: "base-q5_1", source: "automatic", createdAt: 100 },
  );
  assert.equal(note.body, "第一版");
  assert.equal(note.transcriptionModelId, "base-q5_1");
  assert.deepEqual(note.transcriptionRuns, [{
    modelId: "base-q5_1",
    text: "第一版",
    source: "automatic",
    createdAt: 100,
  }]);
});

test("用户编辑后的重复转写只更新候选和历史", () => {
  const note = applyTranscript(
    {
      body: "我的修改",
      userEditVersion: 1,
      transcriptionRuns: [{ modelId: "base-q5_1", text: "第一版", source: "automatic", createdAt: 100 }],
    },
    "第二版",
    { modelId: "small-q5_1", source: "manual", createdAt: 200 },
  );
  assert.equal(note.body, "我的修改");
  assert.equal(note.transcriptCandidate, "第二版");
  assert.equal(note.transcriptionRuns.length, 2);
  assert.equal(note.transcriptionRuns[1].modelId, "small-q5_1");
});

test("用户未编辑时用最新转写更新正文", () => {
  const note = applyTranscript(
    {
      body: "第一版",
      userEditVersion: 0,
      transcriptionRuns: [{ modelId: "base-q5_1", text: "第一版", source: "automatic", createdAt: 100 }],
    },
    "第二版",
    { modelId: "small-q5_1", source: "manual", createdAt: 200 },
  );
  assert.equal(note.body, "第二版");
  assert.equal(note.transcriptCandidate, "");
});

test("未启用时即使内置 Base 已缓存也不转写", () => {
  assert.equal(canTranscribeWithWhisper({
    whisperState: "disabled",
    modelCached: true,
  }), false);
});

test("旧模型选择迁移后仍需启用才允许转写", () => {
  assert.equal(canTranscribeWithWhisper({
    whisperState: "disabled",
    modelCached: true,
    selectedModelId: "base-q5_1",
  }), false);
  assert.equal(canTranscribeWithWhisper({
    whisperState: "ready",
    modelCached: true,
    selectedModelId: "base-q5_1",
  }), true);
});
