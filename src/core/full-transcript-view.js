export const TRANSCRIPT_CUE_GROUP_SIZE = 5;
export const TRANSCRIPT_CUE_GROUP_SIZES = [5, 10, 20];

export function normalizeTranscriptGroupSize(value) {
  const groupSize = Number(value);
  return TRANSCRIPT_CUE_GROUP_SIZES.includes(groupSize)
    ? groupSize
    : TRANSCRIPT_CUE_GROUP_SIZE;
}

export function transcriptCoverage(cues) {
  if (cues.length === 0) return null;
  return {
    startMs: cues[0].startMs,
    endMs: cues.at(-1).endMs,
  };
}

function formatTranscriptTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatTranscriptTimeRange({ startMs, endMs }) {
  const start = formatTranscriptTime(startMs);
  const end = formatTranscriptTime(endMs);
  return start === end ? start : `${start}–${end}`;
}

export function formatTranscriptProgress(completed, total) {
  const totalText = String(total);
  const completedText = String(completed).padStart(totalText.length, "\u2007");
  return `${completedText}/${totalText}`;
}

export function groupTranscriptCues(cues, groupSize = TRANSCRIPT_CUE_GROUP_SIZE) {
  const groups = [];
  const safeGroupSize = Number.isInteger(groupSize) && groupSize > 0
    ? groupSize
    : TRANSCRIPT_CUE_GROUP_SIZE;
  for (let index = 0; index < cues.length; index += safeGroupSize) {
    const group = cues.slice(index, index + safeGroupSize);
    const translations = group.map((cue) => String(cue.translation ?? "").trim());
    const merged = {
      startMs: group[0].startMs,
      endMs: group.at(-1).endMs,
      text: group.map((cue) => cue.text).join(" "),
    };
    if (translations.every(Boolean)) merged.translation = translations.join(" ");
    groups.push(merged);
  }
  return groups;
}

export function transcriptFailureMessageKey(result) {
  if (result?.code === "YOUTUBE_CAPTION_TRACKS_MISSING") return "fullTranscriptMissing";
  if (result?.playerCaptureCode === "YOUTUBE_PLAYER_CAPTION_NOT_OBSERVED") {
    return "fullTranscriptNotObserved";
  }
  if (result?.code === "YOUTUBE_NATIVE_CAPTION_BLOCKED") return "fullTranscriptBlocked";
  return "fullTranscriptFailed";
}
