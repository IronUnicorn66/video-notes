import { subtitleBoundaryStrength } from "./subtitle-segmentation.js";

export const TRANSCRIPT_CUE_GROUP_SIZE = 5;
export const TRANSCRIPT_CUE_GROUP_SIZES = [5, 10, 20];
export const TRANSCRIPT_FONT_SIZE = 12;
export const TRANSCRIPT_FONT_SIZE_MIN = 10;
export const TRANSCRIPT_FONT_SIZE_MAX = 24;

export function normalizeTranscriptGroupSize(value) {
  const groupSize = Number(value);
  return TRANSCRIPT_CUE_GROUP_SIZES.includes(groupSize)
    ? groupSize
    : TRANSCRIPT_CUE_GROUP_SIZE;
}

export function normalizeTranscriptFontSize(value) {
  const fontSize = Number(value);
  if (!Number.isFinite(fontSize)) return TRANSCRIPT_FONT_SIZE;
  return Math.min(
    TRANSCRIPT_FONT_SIZE_MAX,
    Math.max(TRANSCRIPT_FONT_SIZE_MIN, Math.round(fontSize)),
  );
}

export function transcriptFontSizeAfterStep(currentFontSize, direction) {
  const step = Math.sign(Number(direction));
  return normalizeTranscriptFontSize(normalizeTranscriptFontSize(currentFontSize) + step);
}

export function transcriptCoverage(cues) {
  if (cues.length === 0) return null;
  return {
    startMs: cues[0].startMs,
    endMs: cues.at(-1).endMs,
  };
}

export function transcriptGroupIndexAtTime(groups, seconds) {
  const position = Number(seconds);
  if (groups.length === 0 || !Number.isFinite(position) || position < 0) return -1;
  const positionMs = position * 1000;
  if (positionMs < groups[0].startMs) return 0;
  for (let index = 1; index < groups.length; index += 1) {
    if (positionMs < groups[index].startMs) return index - 1;
  }
  return groups.length - 1;
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

export function groupTranscriptCues(
  cues,
  groupSize = TRANSCRIPT_CUE_GROUP_SIZE,
  translations = new Map(),
) {
  const groups = [];
  const safeGroupSize = Number.isInteger(groupSize) && groupSize > 0
    ? groupSize
    : TRANSCRIPT_CUE_GROUP_SIZE;
  for (let index = 0; index < cues.length;) {
    const minimumEnd = Math.min(index + safeGroupSize, cues.length);
    const maximumEnd = Math.min(index + (safeGroupSize * 2), cues.length);
    let end = minimumEnd;

    if (minimumEnd < cues.length) {
      let strongEnd = null;
      for (let candidate = minimumEnd; candidate <= maximumEnd; candidate += 1) {
        if (subtitleBoundaryStrength(cues[candidate - 1]?.text) === "strong") {
          strongEnd = candidate;
          break;
        }
      }
      if (strongEnd !== null) {
        end = strongEnd;
      } else {
        let weakEnd = null;
        for (let candidate = maximumEnd; candidate >= minimumEnd; candidate -= 1) {
          if (subtitleBoundaryStrength(cues[candidate - 1]?.text) === "weak") {
            weakEnd = candidate;
            break;
          }
        }
        end = weakEnd ?? maximumEnd;
      }
    }

    const group = cues.slice(index, end);
    const id = `${index}:${end}`;
    const merged = {
      id,
      sourceStartIndex: index,
      sourceEndIndex: end - 1,
      startMs: group[0].startMs,
      endMs: group.at(-1).endMs,
      text: group.map((cue) => cue.text).join(" "),
    };
    const translation = String(translations.get?.(id) ?? "").trim();
    if (translation) merged.translation = translation;
    groups.push(merged);
    index = end;
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
