export function historyControlState({
  noteCount,
  canUndo,
  canRedo,
  blocked,
  pending,
}) {
  const unavailable = Boolean(blocked || pending);

  return {
    deleteDisabled: unavailable || noteCount <= 0,
    clearDisabled: unavailable || noteCount <= 0,
    undoDisabled: unavailable || !canUndo,
    redoDisabled: unavailable || !canRedo,
  };
}

export function historyShortcut(event) {
  if (
    event.isComposing
    || isEditableTarget(event.target)
    || isInsideOpenDialog(event.target)
    || event.key.toLowerCase() !== "z"
    || event.altKey
    || event.metaKey === event.ctrlKey
  ) {
    return null;
  }

  return event.shiftKey ? "redo" : "undo";
}

export function createHistoryConfirmationController({ getContext, isBlocked, run }) {
  let pending = null;

  function isCurrent(action) {
    if (!action || isBlocked()) return false;
    const context = getContext();
    return Boolean(
      context
      && context.token === action.token
      && context.sessionId === action.sessionId
      && context.tabId === action.tabId
    );
  }

  function takePending() {
    const action = pending;
    pending = null;
    return action;
  }

  function revalidate() {
    if (isCurrent(pending)) return true;
    pending = null;
    return false;
  }

  return {
    get pending() {
      return pending !== null;
    },
    open({ operation, noteId }) {
      if (pending || isBlocked()) return null;
      const context = getContext();
      if (!context || !Number.isInteger(context.tabId) || !context.sessionId) return null;
      pending = {
        operation,
        ...(noteId === undefined ? {} : { noteId }),
        token: context.token,
        sessionId: context.sessionId,
        tabId: context.tabId,
      };
      return { ...pending };
    },
    cancel() {
      return takePending() !== null;
    },
    revalidate,
    async confirm() {
      if (!revalidate()) return false;
      const action = takePending();
      await run(action);
      return true;
    },
  };
}

export function createHistoryOperationController({ request, refresh, showError }) {
  let pending = false;

  return {
    get pending() {
      return pending;
    },
    async run(operation) {
      if (pending) return false;

      pending = true;
      try {
        await request(operation);
        await refresh();
        return true;
      } catch (error) {
        showError(error);
        return false;
      } finally {
        pending = false;
      }
    },
  };
}

function isEditableTarget(target) {
  return target?.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
}

function isInsideOpenDialog(target) {
  if (target?.closest?.("dialog[open]")) return true;

  for (let current = target; current; current = current.parentElement) {
    if (current.tagName === "DIALOG" && current.open) return true;
  }

  return false;
}
