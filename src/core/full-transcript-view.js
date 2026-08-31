export function filterTranscriptCues(cues, query) {
  const normalizedQuery = String(query ?? "").trim().toLocaleLowerCase();
  if (!normalizedQuery) return cues;
  return cues.filter((cue) => cue.text.toLocaleLowerCase().includes(normalizedQuery));
}

export const TRANSCRIPT_CUE_GROUP_SIZE = 5;

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

export function groupTranscriptCues(cues, groupSize = TRANSCRIPT_CUE_GROUP_SIZE) {
  const groups = [];
  for (let index = 0; index < cues.length; index += groupSize) {
    const group = cues.slice(index, index + groupSize);
    groups.push({
      startMs: group[0].startMs,
      endMs: group.at(-1).endMs,
      text: group.map((cue) => cue.text).join(" "),
    });
  }
  return groups;
}

export function transcriptDisplayCues(cues, query, { grouped = true } = {}) {
  const matchedCues = filterTranscriptCues(cues, query);
  if (String(query ?? "").trim()) {
    return { grouped: false, cues: matchedCues };
  }
  return {
    grouped,
    cues: grouped ? groupTranscriptCues(cues) : matchedCues,
  };
}

export function transcriptFailureMessageKey(result) {
  if (result?.code === "YOUTUBE_CAPTION_TRACKS_MISSING") return "fullTranscriptMissing";
  if (result?.playerCaptureCode === "YOUTUBE_PLAYER_CAPTION_NOT_OBSERVED") {
    return "fullTranscriptNotObserved";
  }
  if (result?.code === "YOUTUBE_NATIVE_CAPTION_BLOCKED") return "fullTranscriptBlocked";
  return "fullTranscriptFailed";
}
