export function applySubtitleEdit(note, value, updatedAt = Date.now()) {
  return {
    ...note,
    subtitleContext: String(value ?? "").trim(),
    updatedAt,
  };
}
