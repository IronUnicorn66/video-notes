const TRANSITIONS = {
  disabled: { enable: "downloading" },
  downloading: { downloaded: "ready", fail: "error", disable: "disabled" },
  ready: { record: "recording", disable: "disabled", fail: "error" },
  recording: { stop: "transcribing", fail: "error" },
  transcribing: { complete: "ready", fail: "error" },
  error: { retry: "downloading", disable: "disabled" },
};

export function transitionWhisperState(state, event) {
  const next = TRANSITIONS[state]?.[event];
  if (!next) throw new Error(`非法状态迁移：${state} -> ${event}`);
  return next;
}

export function isWhisperModelSwitchBlocked({
  recording = false,
  starting = false,
  stopping = false,
  downloading = false,
  transcriptionNoteIds = [],
}) {
  return recording || starting || stopping || downloading || transcriptionNoteIds.length > 0;
}

export function assertModelSwitchAllowed({
  whisperState,
  modelDownloading,
  transcriptionCount,
  recording,
}) {
  if (
    modelDownloading
    || recording
    || transcriptionCount > 0
    || ["downloading", "recording", "transcribing"].includes(whisperState)
  ) {
    throw new Error("请等待当前语音任务结束后再切换模型");
  }
}

export function applyTranscript(note, transcript) {
  const text = String(transcript ?? "").trim();
  if ((note.userEditVersion ?? 0) === 0 && !note.body?.trim()) {
    return {
      ...note,
      body: text,
      transcriptCandidate: "",
      transcriptionStatus: "complete",
    };
  }
  return {
    ...note,
    transcriptCandidate: text,
    transcriptionStatus: "complete",
  };
}
