const STORAGE_KEY_PREFIX = "sidePanelViewPosition:";
const DEFAULT_SAVE_DELAY = 200;

function normalizedPosition(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizedSessionId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function storageKey(sessionId) {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

function normalizedTranscriptAnchor(value) {
  if (
    typeof value?.id !== "string"
    || !value.id
    || !Number.isFinite(value.viewportOffset)
  ) return null;
  return {
    id: value.id,
    viewportOffset: value.viewportOffset,
  };
}

function normalizedRecord(value) {
  const transcriptPositions = {};
  if (value?.transcriptPositions && typeof value.transcriptPositions === "object") {
    for (const [groupSize, position] of Object.entries(value.transcriptPositions)) {
      transcriptPositions[groupSize] = normalizedPosition(position);
    }
  }
  const transcriptAnchors = {};
  if (value?.transcriptAnchors && typeof value.transcriptAnchors === "object") {
    for (const [groupSize, anchor] of Object.entries(value.transcriptAnchors)) {
      const normalized = normalizedTranscriptAnchor(anchor);
      if (normalized) transcriptAnchors[groupSize] = normalized;
    }
  }
  return {
    pagePosition: normalizedPosition(value?.pagePosition),
    transcriptPositions,
    transcriptAnchors,
  };
}

export function createSidePanelViewPositionController({
  storage,
  readPagePosition,
  restorePagePosition,
  readTranscriptPosition,
  restoreTranscriptPosition,
  readTranscriptAnchor = () => null,
  restoreTranscriptAnchor = () => false,
  getTranscriptGroupSize,
  saveDelay = DEFAULT_SAVE_DELAY,
  onError = () => {},
}) {
  const records = new Map();
  const loading = new Map();
  const writeQueues = new Map();
  let activeSessionId = null;
  let saveTimer = null;
  let pendingPageRestore = false;
  let pendingTranscriptRestore = false;
  let restoredTranscriptGroupKey = null;

  function groupKey(groupSize = getTranscriptGroupSize()) {
    return String(groupSize);
  }

  async function load(sessionId) {
    if (records.has(sessionId)) return records.get(sessionId);
    if (!loading.has(sessionId)) {
      const key = storageKey(sessionId);
      loading.set(sessionId, storage.get({ [key]: null })
        .then((values) => {
          const record = normalizedRecord(values[key]);
          records.set(sessionId, record);
          return record;
        })
        .catch((error) => {
          onError(error);
          const record = normalizedRecord(null);
          records.set(sessionId, record);
          return record;
        })
        .finally(() => loading.delete(sessionId)));
    }
    return loading.get(sessionId);
  }

  function persist(sessionId) {
    const key = storageKey(sessionId);
    const previous = writeQueues.get(sessionId) ?? Promise.resolve();
    const write = previous.then(async () => {
      const record = records.get(sessionId);
      if (record) await storage.set({ [key]: structuredClone(record) });
    });
    const handled = write.catch(onError);
    writeQueues.set(sessionId, handled);
    return handled.finally(() => {
      if (writeQueues.get(sessionId) === handled) writeQueues.delete(sessionId);
    });
  }

  function capture({
    groupSize = getTranscriptGroupSize(),
    includePage = true,
    includeTranscript = true,
  } = {}) {
    if (!activeSessionId || !records.has(activeSessionId)) return false;
    if (!includePage && !includeTranscript) return false;
    const record = records.get(activeSessionId);
    if (includePage) record.pagePosition = normalizedPosition(readPagePosition());
    if (includeTranscript) {
      const transcriptGroupKey = groupKey(groupSize);
      record.transcriptPositions[transcriptGroupKey] = normalizedPosition(
        readTranscriptPosition(),
      );
      const anchor = normalizedTranscriptAnchor(readTranscriptAnchor());
      if (anchor) record.transcriptAnchors[transcriptGroupKey] = anchor;
    }
    return true;
  }

  return {
    async activate(sessionId) {
      const nextSessionId = normalizedSessionId(sessionId);
      if (nextSessionId === activeSessionId) {
        if (nextSessionId) await load(nextSessionId);
        return false;
      }
      const previousSessionId = activeSessionId;
      if (
        previousSessionId
        && capture({
          includePage: !pendingPageRestore,
          includeTranscript: !pendingTranscriptRestore,
        })
      ) {
        void persist(previousSessionId);
      }
      activeSessionId = nextSessionId;
      pendingPageRestore = Boolean(nextSessionId);
      pendingTranscriptRestore = Boolean(nextSessionId);
      restoredTranscriptGroupKey = null;
      if (nextSessionId) await load(nextSessionId);
      return true;
    },
    capture,
    prepareTranscriptGroupChange() {
      const captured = capture();
      pendingTranscriptRestore = Boolean(activeSessionId);
      if (captured) void persist(activeSessionId);
      return captured;
    },
    prepareContentReload() {
      const captured = capture({
        includePage: !pendingPageRestore,
        includeTranscript: !pendingTranscriptRestore,
      });
      pendingPageRestore = Boolean(activeSessionId);
      pendingTranscriptRestore = Boolean(activeSessionId);
      restoredTranscriptGroupKey = null;
      if (captured) void persist(activeSessionId);
      return captured;
    },
    async restorePage({ deferIfClamped = false } = {}) {
      const sessionId = activeSessionId;
      if (!sessionId || !pendingPageRestore) return false;
      const record = await load(sessionId);
      if (activeSessionId !== sessionId) return false;
      restorePagePosition(record.pagePosition);
      const clamped = readPagePosition() + 0.5 < record.pagePosition;
      pendingPageRestore = deferIfClamped && clamped;
      return true;
    },
    async restoreTranscript() {
      const sessionId = activeSessionId;
      const transcriptGroupKey = groupKey();
      if (
        !sessionId
        || (!pendingTranscriptRestore && restoredTranscriptGroupKey === transcriptGroupKey)
      ) return false;
      const record = await load(sessionId);
      if (activeSessionId !== sessionId || groupKey() !== transcriptGroupKey) return false;
      const fallbackPosition = record.transcriptPositions[transcriptGroupKey] ?? 0;
      restoreTranscriptPosition(fallbackPosition);
      const anchor = record.transcriptAnchors[transcriptGroupKey];
      if (anchor) restoreTranscriptAnchor(anchor, fallbackPosition);
      pendingTranscriptRestore = false;
      restoredTranscriptGroupKey = transcriptGroupKey;
      return true;
    },
    scheduleSave() {
      if (!activeSessionId) return false;
      capture({
        includePage: !pendingPageRestore,
        includeTranscript: !pendingTranscriptRestore,
      });
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        if (activeSessionId) void persist(activeSessionId);
      }, saveDelay);
      return true;
    },
    async flush() {
      clearTimeout(saveTimer);
      saveTimer = null;
      const sessionId = activeSessionId;
      if (!sessionId) return false;
      await load(sessionId);
      if (activeSessionId !== sessionId) return false;
      capture({
        includePage: !pendingPageRestore,
        includeTranscript: !pendingTranscriptRestore,
      });
      await persist(sessionId);
      return true;
    },
    deactivate() {
      const sessionId = activeSessionId;
      if (
        sessionId
        && capture({
          includePage: !pendingPageRestore,
          includeTranscript: !pendingTranscriptRestore,
        })
      ) {
        void persist(sessionId);
      }
      activeSessionId = null;
      pendingPageRestore = false;
      pendingTranscriptRestore = false;
      restoredTranscriptGroupKey = null;
    },
  };
}
