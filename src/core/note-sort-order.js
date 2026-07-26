export function normalizeNoteSortOrder(value) {
  return value === "oldest" ? "oldest" : "newest";
}

export function sortNotesForDisplay(notes, order) {
  const direction = normalizeNoteSortOrder(order) === "oldest" ? 1 : -1;
  return [...notes].sort((left, right) => (
    direction * (left.createdAt - right.createdAt)
  ));
}
