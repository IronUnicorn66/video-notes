export function filterTranscriptCues(cues, query) {
  const normalizedQuery = String(query ?? "").trim().toLocaleLowerCase();
  if (!normalizedQuery) return cues;
  return cues.filter((cue) => cue.text.toLocaleLowerCase().includes(normalizedQuery));
}

export function transcriptFailureMessageKey(result) {
  if (result?.code === "YOUTUBE_CAPTION_TRACKS_MISSING") return "fullTranscriptMissing";
  if (result?.playerCaptureCode === "YOUTUBE_PLAYER_CAPTION_NOT_OBSERVED") {
    return "fullTranscriptNotObserved";
  }
  if (result?.code === "YOUTUBE_NATIVE_CAPTION_BLOCKED") return "fullTranscriptBlocked";
  return "fullTranscriptFailed";
}
