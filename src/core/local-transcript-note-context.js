export const NOTE_SUBTITLE_MAX_CHARS = 500;

function normalizedGroup(group) {
  const startMs = Number(group?.startMs);
  const endMs = Number(group?.endMs);
  const text = String(group?.text ?? "").trim();
  if (
    !Number.isFinite(startMs)
    || !Number.isFinite(endMs)
    || startMs < 0
    || endMs < startMs
    || !text
  ) return null;
  return {
    startMs,
    endMs,
    text,
    translation: String(group?.translation ?? "").trim(),
  };
}

function matchingGroups(groups, windowStartMs, markerMs) {
  return (Array.isArray(groups) ? groups : [])
    .map(normalizedGroup)
    .filter(Boolean)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
    .filter((group) => group.endMs >= windowStartMs && group.startMs <= markerMs);
}

function groupsWithinCharacterTarget(groups, maxChars) {
  const selected = [];
  let length = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    const nextLength = length + (selected.length > 0 ? 1 : 0) + group.text.length;
    if (selected.length > 0 && nextLength > maxChars) break;
    selected.unshift(group);
    length = nextLength;
  }
  return selected;
}

export function localTranscriptNoteContext({
  context,
  source,
  preferredSource,
  markerSeconds,
  windowSeconds,
  maxChars = NOTE_SUBTITLE_MAX_CHARS,
  enabled = true,
} = {}) {
  const marker = Number(markerSeconds);
  const window = Number(windowSeconds);
  const limit = Number(maxChars);
  if (
    enabled !== true
    || context?.platform !== "youtube"
    || !Number.isFinite(marker)
    || marker < 0
    || !Number.isFinite(window)
    || window <= 0
    || !Number.isFinite(limit)
    || limit <= 0
  ) return null;

  const currentSource = preferredSource
    && preferredSource.sessionId === context.sessionId
    && preferredSource.videoId === context.videoId
    && Array.isArray(preferredSource.groups)
    ? preferredSource
    : source;
  if (
    !currentSource
    || currentSource.sessionId !== context.sessionId
    || currentSource.videoId !== context.videoId
  ) return null;

  const markerMs = marker * 1000;
  const groups = groupsWithinCharacterTarget(
    matchingGroups(currentSource.groups, Math.max(0, markerMs - (window * 1000)), markerMs),
    limit,
  );
  if (groups.length === 0) return null;

  const translationsComplete = groups.every((group) => group.translation);
  return {
    subtitleContext: groups.map((group) => group.text).join("\n"),
    subtitleTranslation: translationsComplete
      ? groups.map((group) => group.translation).join("\n")
      : "",
  };
}
