export const NOTE_FONT_SIZE = 13;
export const NOTE_FONT_SIZE_MIN = 10;
export const NOTE_FONT_SIZE_MAX = 24;

export function normalizeNoteFontSize(value) {
  const fontSize = Number(value);
  if (!Number.isFinite(fontSize)) return NOTE_FONT_SIZE;
  return Math.min(
    NOTE_FONT_SIZE_MAX,
    Math.max(NOTE_FONT_SIZE_MIN, Math.round(fontSize)),
  );
}

export function noteFontSizeAfterStep(currentFontSize, direction) {
  const step = Math.sign(Number(direction));
  return normalizeNoteFontSize(normalizeNoteFontSize(currentFontSize) + step);
}
