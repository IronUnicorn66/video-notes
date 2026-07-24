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

