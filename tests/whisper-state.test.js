import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTranscript,
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

test("未编辑的空语音标记直接采用转写", () => {
  const note = applyTranscript({ body: "", userEditVersion: 0 }, "口述内容");
  assert.equal(note.body, "口述内容");
  assert.equal(note.transcriptCandidate, "");
  assert.equal(note.transcriptionStatus, "complete");
});

test("用户已编辑时保留正文并将迟到转写存为候选", () => {
  const note = applyTranscript({ body: "用户内容", userEditVersion: 2 }, "口述内容");
  assert.equal(note.body, "用户内容");
  assert.equal(note.transcriptCandidate, "口述内容");
});
