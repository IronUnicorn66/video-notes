const TRAILING_CLOSERS = String.raw`(?:["'”’」』】）)\]》〉〕〗〙〛]*)`;
const STRONG_BOUNDARY = new RegExp(`[.!?。！？…]${TRAILING_CLOSERS}$`, "u");
const WEAK_BOUNDARY = new RegExp(`[,，;；:：、]${TRAILING_CLOSERS}$`, "u");
const STRONG_CHARACTERS = new Set([".", "!", "?", "。", "！", "？", "…"]);
const UNCONDITIONAL_STRONG_CHARACTERS = new Set(["。", "！", "？", "…"]);
const WEAK_CHARACTERS = new Set([",", "，", ";", "；", ":", "：", "、"]);
const CLOSING_CHARACTERS = new Set([
  '"', "'", "”", "’", "」", "』", "】", "）", ")", "]", "》", "〉", "〕", "〗", "〙", "〛",
]);
const COMPACT_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function subtitleBoundaryStrength(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return null;
  if (STRONG_BOUNDARY.test(normalized)) return "strong";
  if (WEAK_BOUNDARY.test(normalized)) return "weak";
  return null;
}

function normalizedFragment(text) {
  return String(text ?? "")
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function isSubtitleWordBoundary(character) {
  return character === undefined
    || /\s/u.test(character)
    || STRONG_CHARACTERS.has(character)
    || WEAK_CHARACTERS.has(character)
    || CLOSING_CHARACTERS.has(character);
}

function subtitleOverlapLength(previous, next) {
  const maximum = Math.min(previous.length, next.length);
  for (let length = maximum; length > 0; length -= 1) {
    const overlap = next.slice(0, length);
    if (!previous.endsWith(overlap)) continue;
    if (COMPACT_SCRIPT.test(overlap) && length >= 2) return length;
    if (
      length >= 4
      && isSubtitleWordBoundary(previous[previous.length - length - 1])
      && isSubtitleWordBoundary(next[length])
    ) return length;
  }
  return 0;
}

function collapsedSubtitleFragments(fragments) {
  const collapsed = [];
  for (const value of fragments) {
    const fragment = normalizedFragment(value);
    if (!fragment) continue;
    const previous = collapsed.at(-1);
    if (previous === fragment || previous?.startsWith(fragment)) continue;
    if (
      previous
      && fragment.startsWith(previous)
      && (COMPACT_SCRIPT.test(previous) || isSubtitleWordBoundary(fragment[previous.length]))
    ) {
      collapsed[collapsed.length - 1] = fragment;
      continue;
    }
    const overlapLength = previous ? subtitleOverlapLength(previous, fragment) : 0;
    if (overlapLength > 0) {
      collapsed[collapsed.length - 1] = previous + fragment.slice(overlapLength);
    } else {
      collapsed.push(fragment);
    }
  }
  return collapsed;
}

function splitSubtitleLine(text) {
  const pieces = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (!STRONG_CHARACTERS.has(character)) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < text.length && STRONG_CHARACTERS.has(text[end])) end += 1;
    while (end < text.length && CLOSING_CHARACTERS.has(text[end])) end += 1;
    const next = text[end];
    const complete = UNCONDITIONAL_STRONG_CHARACTERS.has(character)
      || next === undefined
      || /\s/u.test(next);
    if (!complete) {
      index = end;
      continue;
    }

    const value = text.slice(start, end).trim();
    if (value) pieces.push({ text: value, complete: true });
    while (end < text.length && /\s/u.test(text[end])) end += 1;
    start = end;
    index = end;
  }

  const residual = text.slice(start).trim();
  if (residual) pieces.push({ text: residual, complete: false });
  return pieces;
}

function appendSubtitleText(current, next) {
  if (!current) return next;
  const previousCharacter = current.at(-1);
  const nextCharacter = next[0];
  const separator = COMPACT_SCRIPT.test(previousCharacter)
    || COMPACT_SCRIPT.test(nextCharacter)
    || STRONG_CHARACTERS.has(nextCharacter)
    || WEAK_CHARACTERS.has(nextCharacter)
    ? ""
    : " ";
  return `${current}${separator}${next}`;
}

export function formatSubtitleFragments(fragments) {
  const paragraphs = [];
  let current = "";
  for (const fragment of collapsedSubtitleFragments(fragments)) {
    const lines = fragment.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      for (const piece of splitSubtitleLine(lines[lineIndex])) {
        current = appendSubtitleText(current, piece.text);
        if (piece.complete) {
          paragraphs.push(current);
          current = "";
        }
      }
      if (lineIndex < lines.length - 1 && current) {
        paragraphs.push(current);
        current = "";
      }
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n");
}

export function truncateSubtitleText(text, maxChars) {
  const normalized = String(text ?? "").trim();
  if (!normalized || maxChars <= 0) return "";
  if (normalized.length <= maxChars) return normalized;

  const tail = normalized.slice(-maxChars);
  const searchLimit = Math.max(1, Math.floor(maxChars / 3));
  for (let index = 0; index < Math.min(searchLimit, tail.length); index += 1) {
    const character = tail[index];
    if (character !== "\n" && !STRONG_CHARACTERS.has(character) && !WEAK_CHARACTERS.has(character)) {
      continue;
    }
    let start = index + 1;
    while (start < tail.length && CLOSING_CHARACTERS.has(tail[start])) start += 1;
    const candidate = tail.slice(start).trimStart();
    if (candidate) return candidate;
  }
  return tail;
}
