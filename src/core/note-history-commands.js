const NOTE_HISTORY_COMMAND_TYPES = new Set([
  "GET_ACTIVE_STATE",
  "COMMIT_TYPED_NOTE",
  "UPDATE_NOTE_BODY",
  "UPDATE_NOTE_SUBTITLE",
  "DELETE_NOTE",
  "CLEAR_SESSION_NOTES",
  "UNDO_NOTE_ACTION",
  "REDO_NOTE_ACTION",
]);

export function isNoteHistoryCommand(type) {
  return NOTE_HISTORY_COMMAND_TYPES.has(type);
}

export function createNoteHistoryCommandRouter({
  repository,
  getCurrentContext,
  onTypedNoteCommitted = async () => {},
}) {
  async function requireCurrentSession(sessionId, request) {
    const context = await getCurrentContext(request);
    if (!context || context.sessionId !== sessionId) throw new Error("当前页面会话不匹配");
    return context;
  }

  return async function route(message, request) {
    switch (message.type) {
      case "GET_ACTIVE_STATE": {
        const context = await getCurrentContext(request);
        if (!context) {
          return {
            context: null,
            notes: [],
            history: { canUndo: false, canRedo: false },
          };
        }
        const history = await repository.getNoteHistoryState(context.sessionId);
        return {
          context,
          notes: await repository.listNotes(context.sessionId),
          history: { canUndo: history.canUndo, canRedo: history.canRedo },
        };
      }
      case "COMMIT_TYPED_NOTE": {
        const note = await repository.commitSavedNote(message.noteId, {
          body: String(message.body ?? "").trim(),
          userEditVersion: 1,
          status: "saved",
        });
        await onTypedNoteCommitted(note);
        return { note };
      }
      case "UPDATE_NOTE_BODY":
        return { note: await repository.editNoteBody(message.noteId, message.body) };
      case "UPDATE_NOTE_SUBTITLE":
        return { note: await repository.editNoteSubtitle(message.noteId, message.subtitleContext) };
      case "DELETE_NOTE": {
        await requireCurrentSession(message.sessionId, request);
        const note = await repository.getNote(message.noteId);
        if (!note || note.sessionId !== message.sessionId) {
          throw new Error("标记不属于当前页面会话");
        }
        return repository.deleteSavedNote(message.noteId);
      }
      case "CLEAR_SESSION_NOTES":
        await requireCurrentSession(message.sessionId, request);
        return repository.clearSessionNotes(message.sessionId);
      case "UNDO_NOTE_ACTION":
        await requireCurrentSession(message.sessionId, request);
        return repository.undoNoteAction(message.sessionId);
      case "REDO_NOTE_ACTION":
        await requireCurrentSession(message.sessionId, request);
        return repository.redoNoteAction(message.sessionId);
      default:
        return undefined;
    }
  };
}

export async function persistRecordedNote({
  repository,
  noteId,
  audio,
  audioKey,
  transcriptionStatus,
  now = Date.now(),
}) {
  await repository.putAsset(audioKey, audio);
  try {
    return await repository.commitSavedNote(noteId, {
      audioKey,
      status: "saved",
      transcriptionStatus,
    }, now);
  } catch (error) {
    await repository.deleteAsset(audioKey);
    throw error;
  }
}
