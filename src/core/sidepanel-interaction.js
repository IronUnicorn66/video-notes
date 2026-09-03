import {
  inlineEditResolution,
  inlineEditStartingText,
  shouldDeferInlineEditRefresh,
} from "./inline-edit-state.js";

export function createSidePanelInlineEditController({
  onEditStarted = () => {},
  onError = () => {},
  flushDeferredRefresh = () => false,
  isStartBlocked = () => false,
} = {}) {
  const editing = new Set();
  const pendingSaves = new Set();
  const retries = new Map();
  const generations = new WeakMap();

  function isBlocked() {
    return shouldDeferInlineEditRefresh({
      editing: editing.size > 0,
      pendingSaveCount: pendingSaves.size,
      retryCount: retries.size,
    });
  }

  function flushIfResolved() {
    if (!isBlocked()) flushDeferredRefresh();
  }

  function begin({
    noteId,
    button,
    content,
    initialText,
    restore,
    save,
    applySaved,
  }) {
    if (
      isStartBlocked()
      || button.disabled
      || editing.has(content)
      || pendingSaves.has(content)
    ) return null;

    const generation = (generations.get(content) ?? 0) + 1;
    generations.set(content, generation);
    const isCurrent = () => generations.get(content) === generation;
    let canceled = false;
    let finished = false;
    let resolveCompletion;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });

    editing.add(content);
    button.disabled = true;
    content.textContent = inlineEditStartingText(retries.get(content), initialText);
    content.contentEditable = "true";
    content.classList.remove("is-empty");
    content.classList.add("is-editing");
    content.focus();
    onEditStarted({ noteId, content });

    let keyHandler;
    const finish = async () => {
      if (finished) return;
      finished = true;
      const submittedText = String(content.textContent ?? "");
      let saveSucceeded = false;

      content.removeEventListener("keydown", keyHandler);
      content.contentEditable = "false";
      content.classList.remove("is-editing");
      editing.delete(content);

      if (canceled) {
        if (isCurrent()) {
          retries.delete(content);
          restore();
          button.disabled = false;
        }
        flushIfResolved();
        resolveCompletion({ canceled, saveSucceeded, submittedText });
        return;
      }

      pendingSaves.add(content);
      try {
        const response = await save(submittedText);
        if (isCurrent()) {
          applySaved(response, submittedText);
          retries.delete(content);
          saveSucceeded = true;
        }
      } catch (error) {
        if (isCurrent()) {
          content.textContent = submittedText;
          retries.set(content, submittedText);
          onError(error);
        }
      } finally {
        pendingSaves.delete(content);
        if (isCurrent()) button.disabled = false;
        const resolution = inlineEditResolution({
          canceled,
          saveSucceeded,
          text: submittedText,
        });
        if (isCurrent() && resolution.retryText !== null) {
          retries.set(content, resolution.retryText);
        }
        if (resolution.allowDeferredRefresh) flushIfResolved();
        resolveCompletion({ canceled, saveSucceeded, submittedText });
      }
    };

    content.addEventListener("blur", () => void finish(), { once: true });
    keyHandler = (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        canceled = true;
        content.blur();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        content.blur();
      }
    };
    content.addEventListener("keydown", keyHandler);

    return { completion };
  }

  function bind({ getInitialText, ...options }) {
    const clickHandler = () => begin({
      ...options,
      initialText: getInitialText(),
    });
    options.button.addEventListener("click", clickHandler);
    return () => options.button.removeEventListener("click", clickHandler);
  }

  return {
    get blocked() {
      return isBlocked();
    },
    get pendingSaveCount() {
      return pendingSaves.size;
    },
    get retryCount() {
      return retries.size;
    },
    begin,
    bind,
  };
}

export function createSidePanelRefreshRunner({
  load,
  apply,
  applyError,
  isBlocked = () => false,
  defer = () => {},
}) {
  let generation = 0;
  let pendingCount = 0;
  let appliedGeneration = 0;
  let appliedError = null;
  const appliedWaiters = new Set();

  function markApplied(error = null) {
    appliedGeneration += 1;
    appliedError = error;
    for (const waiter of appliedWaiters) {
      if (error) waiter.reject(error);
      else waiter.resolve(true);
    }
    appliedWaiters.clear();
  }

  function waitForApplied(generationToWaitFor) {
    if (appliedGeneration !== generationToWaitFor) {
      return appliedError ? Promise.reject(appliedError) : Promise.resolve(true);
    }

    return new Promise((resolve, reject) => {
      appliedWaiters.add({ reject, resolve });
    });
  }

  async function run({ rejectOnError = false } = {}) {
    const currentGeneration = ++generation;
    pendingCount += 1;
    try {
      const value = await load();
      if (currentGeneration !== generation) return false;
      if (isBlocked()) {
        defer();
        return false;
      }
      await apply(value, () => currentGeneration === generation);
      if (currentGeneration !== generation) return false;
      markApplied();
      return true;
    } catch (error) {
      if (currentGeneration !== generation) return false;
      if (isBlocked()) {
        defer();
        return false;
      }
      applyError(error);
      markApplied(error);
      if (rejectOnError) throw error;
      return true;
    } finally {
      pendingCount -= 1;
    }
  }

  function invalidateForEdit() {
    const hadPendingRefresh = pendingCount > 0;
    generation += 1;
    if (hadPendingRefresh) defer();
    return hadPendingRefresh;
  }

  async function runUntilApplied() {
    while (true) {
      const currentAppliedGeneration = appliedGeneration;
      if (await run({ rejectOnError: true })) return true;
      if (isBlocked()) {
        return waitForApplied(currentAppliedGeneration);
      }
    }
  }

  return {
    get pendingCount() {
      return pendingCount;
    },
    invalidateForEdit,
    run,
    runUntilApplied,
  };
}
