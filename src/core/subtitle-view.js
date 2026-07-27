export function subtitleBlockState(note, enabled) {
  const text = String(note?.subtitleContext ?? "").trim();
  return {
    visible: enabled === true,
    empty: text.length === 0,
    text,
  };
}
