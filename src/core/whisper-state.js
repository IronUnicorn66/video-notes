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

export function canTranscribeWithWhisper({ whisperState, modelCached }) {
  return whisperState === "ready" && modelCached === true;
}

export function createNoteTaskCoordinator() {
  const tails = new Map();
  return (noteId, operation) => {
    const previous = tails.get(noteId) ?? Promise.resolve();
    const task = previous.then(operation);
    const tracked = task.then(() => {}, () => {}).finally(() => {
      if (tails.get(noteId) === tracked) tails.delete(noteId);
    });
    tails.set(noteId, tracked);
    return task;
  };
}

export function applyTranscript(note, transcript, {
  modelId,
  source,
  createdAt = Date.now(),
}) {
  const text = String(transcript ?? "").trim();
  const run = { modelId, text, source, createdAt };
  const next = {
    ...note,
    transcriptionStatus: "complete",
    transcriptionModelId: modelId,
    transcriptionRuns: [...(note.transcriptionRuns ?? []), run],
    pendingTranscription: null,
  };
  if ((note.userEditVersion ?? 0) === 0) {
    return {
      ...next,
      body: text,
      transcriptCandidate: "",
    };
  }
  return {
    ...next,
    transcriptCandidate: text,
  };
}
