export const NOTE_HISTORY_LIMIT = 50;

const ACTION_TYPES = new Set([
  "add-note",
  "edit-body",
  "edit-subtitle",
  "delete-note",
  "clear-session",
]);

export function emptyNoteHistory(sessionId) {
  return { sessionId, undo: [], redo: [], updatedAt: 0 };
}

export function recordNoteAction(history, action) {
  if (!ACTION_TYPES.has(action?.type) || !Array.isArray(action.noteIds)) {
    throw new Error("无效的笔记历史动作");
  }
  return {
    ...history,
    undo: [...history.undo, structuredClone(action)].slice(-NOTE_HISTORY_LIMIT),
    redo: [],
    updatedAt: action.createdAt,
  };
}

export function undoNoteHistory(history) {
  const action = history.undo.at(-1) ?? null;
  if (action === null) {
    return { action, history };
  }
  return {
    action,
    history: {
      ...history,
      undo: history.undo.slice(0, -1),
      redo: [...history.redo, action],
    },
  };
}

export function redoNoteHistory(history) {
  const action = history.redo.at(-1) ?? null;
  if (action === null) {
    return { action, history };
  }
  return {
    action,
    history: {
      ...history,
      undo: [...history.undo, action],
      redo: history.redo.slice(0, -1),
    },
  };
}

export function referencedNoteIds(history) {
  return new Set([...history.undo, ...history.redo].flatMap(({ noteIds }) => noteIds));
}
