export function subtitleBlockState(note, enabled) {
  const text = String(note?.subtitleContext ?? "").trim();
  const translation = String(note?.subtitleTranslation ?? "").trim();
  return {
    visible: enabled === true,
    empty: text.length === 0,
    text,
    translation,
  };
}
