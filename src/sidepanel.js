import { formatTimestamp } from "./core/note-format.js";
import { sortNotesForDisplay } from "./core/note-sort-order.js";
import {
  createSidepanelNoteSortBinding,
  initializeSidepanel,
} from "./core/sidepanel-note-sort.js";
import { createSidepanelZoomBinding } from "./core/sidepanel-zoom.js";
import { WHISPER_ORIGINS } from "./core/model-config.js";
import { SCREENSHOT_ORIGINS } from "./core/media-permissions.js";
import {
  createAssetUrlRegistry,
  loadNoteAssets,
  stopNoteMedia,
} from "./core/asset-url-registry.js";
import { VideoNotesRepository } from "./core/storage.js";
import {
  createSidePanelRefreshController,
  isSidePanelRefreshMessage,
} from "./core/sidepanel-scope.js";
import {
  createSidePanelInlineEditController,
  createSidePanelRefreshRunner,
} from "./core/sidepanel-interaction.js";
import { normalizeSubtitleSettings } from "./core/subtitle-capture.js";
import { subtitleBlockState } from "./core/subtitle-view.js";
import {
  formatTranscriptTimeRange,
  transcriptCoverage,
  transcriptDisplayCues,
  transcriptFailureMessageKey,
} from "./core/full-transcript-view.js";
import {
  createHistoryConfirmationController,
  createHistoryOperationController,
  historyControlState,
  historyShortcut,
} from "./core/note-history-controls.js";
import { localizeRuntimeMessage, translate } from "./core/i18n.js";
import {
  localizeDocument,
  readInterfaceLanguage,
  writeInterfaceLanguage,
} from "./core/extension-language.js";

const interfaceLanguage = await readInterfaceLanguage(
  chrome.storage.local,
  chrome.i18n.getUILanguage(),
);
const t = (key, variables) => translate(interfaceLanguage, key, variables);
localizeDocument(document, interfaceLanguage);

const elements = {
  languageButtons: document.querySelectorAll("[data-interface-language]"),
  videoTitle: document.querySelector("#video-title"),
  videoUrl: document.querySelector("#video-url"),
  input: document.querySelector("#note-input"),
  markerTime: document.querySelector("#marker-time"),
  voiceButton: document.querySelector("#voice-button"),
  voiceLabel: document.querySelector("#voice-button-label"),
  recordingStatus: document.querySelector("#recording-status"),
  recordingTimer: document.querySelector("#recording-timer"),
  fullTranscriptPanel: document.querySelector("#full-transcript-panel"),
  fullTranscriptStatus: document.querySelector("#full-transcript-status"),
  fullTranscriptSearch: document.querySelector("#full-transcript-search"),
  fullTranscriptDisplayToggle: document.querySelector("#full-transcript-display-toggle"),
  fullTranscriptRetry: document.querySelector("#full-transcript-retry"),
  fullTranscriptList: document.querySelector("#full-transcript-list"),
  fullTranscriptEmpty: document.querySelector("#full-transcript-empty"),
  noteList: document.querySelector("#note-list"),
  emptyNotes: document.querySelector("#empty-notes"),
  noteSortButtons: document.querySelectorAll("[data-note-sort-order]"),
  undoButton: document.querySelector("#undo-button"),
  redoButton: document.querySelector("#redo-button"),
  clearButton: document.querySelector("#clear-button"),
  exportButton: document.querySelector("#export-button"),
  whisperDetail: document.querySelector("#whisper-detail"),
  whisperModelSelect: document.querySelector("#whisper-model-select"),
  whisperModelAction: document.querySelector("#whisper-model-action"),
  whisperModelWarning: document.querySelector("#whisper-model-warning"),
  settings: document.querySelector("#permission-settings"),
  screenshotPermissionButton: document.querySelector("#screenshot-permission-button"),
  screenshotPermissionDetail: document.querySelector("#screenshot-permission-detail"),
  microphonePermissionButton: document.querySelector("#microphone-permission-button"),
  microphonePermissionDetail: document.querySelector("#microphone-permission-detail"),
  subtitleEnabled: document.querySelector("#subtitle-enabled"),
  subtitleWindowSeconds: document.querySelector("#subtitle-window-seconds"),
  keyButton: document.querySelector("#key-button"),
  toast: document.querySelector("#toast"),
  screenshotDialog: document.querySelector("#screenshot-dialog"),
  screenshotDialogClose: document.querySelector("#screenshot-dialog-close"),
  screenshotDialogImage: document.querySelector("#screenshot-dialog-image"),
  historyConfirmDialog: document.querySelector("#history-confirm-dialog"),
  historyConfirmTitle: document.querySelector("#history-confirm-title"),
  historyConfirmDescription: document.querySelector("#history-confirm-description"),
};

const repository = new VideoNotesRepository();
const assetUrls = createAssetUrlRegistry();

let activeContext = null;
let currentDraft = null;
let draftPromise = null;
let typedDraftSaving = false;
let isComposing = false;
let commitAfterComposition = false;
let recording = false;
let voiceStarting = false;
let voiceStopping = false;
let pendingVoiceStopReason = null;
let recordingStartedAt = 0;
let recordingInterval = null;
let recordingTimeout = null;
let toastTimeout = null;
let refreshAfterEdit = false;
let inlineEditController = null;
let refreshRunner = null;
let microphoneReady = false;
let microphonePermissionStatus = null;
let pendingWhisperModelId = null;
let whisperStatus = null;
let renderGeneration = 0;
let currentNotes = [];
let canUndo = false;
let canRedo = false;
let historyContextToken = 0;
let activeContextTabId = null;
let historyConfirmationController = null;
let historyOperationController = null;
let subtitleSettings = normalizeSubtitleSettings();
let fullTranscript = null;
let fullTranscriptContextKey = "";
let fullTranscriptGeneration = 0;
let fullTranscriptLoading = false;
let fullTranscriptGrouped = true;

const noteSortBinding = createSidepanelNoteSortBinding({
  buttons: elements.noteSortButtons,
  storage: chrome.storage,
  getNotes: () => currentNotes,
  renderNotes,
  isEditing: () => Boolean(inlineEditController?.blocked),
  showToast,
});

const sidepanelZoomBinding = createSidepanelZoomBinding({
  target: window,
  root: document.documentElement,
  storage: chrome.storage,
  showToast,
});

const sidePanelRefresh = createSidePanelRefreshController(() => {
  void refreshNow();
}, {
  onContextEvent(message) {
    if (["ACTIVE_CONTEXT_CHANGED", "TAB_LOAD_COMPLETE"].includes(message.type)) {
      historyContextToken += 1;
      closeStaleHistoryConfirmation();
    }
    if (message.type === "VOICE_STATE_CHANGED") setRecordingUi(message.recording);
  },
  shouldRefresh(message) {
    return message.type !== "VOICE_STATE_CHANGED" || message.recording === false;
  },
  shouldDeferRefresh(message) {
    if (!inlineEditController?.blocked) return false;
    refreshAfterEdit = true;
    return true;
  },
});

function showToast(message) {
  elements.toast.textContent = localizeRuntimeMessage(interfaceLanguage, message);
  elements.toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    elements.toast.hidden = true;
  }, 3600);
}

function syncSubtitleSettingsControls() {
  elements.subtitleEnabled.checked = subtitleSettings.enabled;
  elements.subtitleWindowSeconds.value = String(subtitleSettings.windowSeconds);
  elements.subtitleWindowSeconds.disabled = !subtitleSettings.enabled;
}

inlineEditController = createSidePanelInlineEditController({
  isStartBlocked: () => Boolean(historyOperationController?.pending),
  onEditStarted() {
    refreshRunner?.invalidateForEdit();
    syncHistoryControls();
  },
  onError(error) {
    showToast(error.message);
    syncHistoryControls();
  },
  flushDeferredRefresh() {
    syncHistoryControls();
    if (!refreshAfterEdit) {
      noteSortBinding.finishEditing();
      return false;
    }
    refreshAfterEdit = false;
    noteSortBinding.finishEditing({ render: false });
    return sidePanelRefresh.flushDeferredRefresh();
  },
});

historyOperationController = createHistoryOperationController({
  request,
  refresh: () => refreshRunner.runUntilApplied(),
  showError(error) {
    showToast(error.message);
  },
  showSuccess(operation) {
    const message = {
      DELETE_NOTE: t("deleteSuccess"),
      CLEAR_SESSION_NOTES: t("clearSuccess"),
      UNDO_NOTE_ACTION: t("undoSuccess"),
      REDO_NOTE_ACTION: t("redoSuccess"),
    }[operation.type];
    if (message) showToast(message);
  },
});

historyConfirmationController = createHistoryConfirmationController({
  getContext() {
    if (!activeContext) return null;
    return {
      token: historyContextToken,
      sessionId: activeContext.sessionId,
      tabId: sidePanelRefresh.tabId,
    };
  },
  isBlocked: historyInteractionBlocked,
  run: runConfirmedHistoryAction,
});

function savedNoteCount() {
  return currentNotes.filter((note) => note.status === "saved").length;
}

function historyInteractionBlocked() {
  return Boolean(
    currentDraft
    || draftPromise
    || recording
    || voiceStarting
    || inlineEditController.blocked
    || typedDraftSaving
    || voiceStopping
    || historyOperationController?.pending
  );
}

function currentHistoryControlState() {
  return historyControlState({
    noteCount: savedNoteCount(),
    canUndo,
    canRedo,
    blocked: historyInteractionBlocked(),
    pending: historyOperationController.pending,
  });
}

function syncHistoryControls() {
  closeStaleHistoryConfirmation();
  const controls = currentHistoryControlState();
  elements.clearButton.disabled = controls.clearDisabled;
  elements.undoButton.disabled = controls.undoDisabled;
  elements.redoButton.disabled = controls.redoDisabled;
  for (const deleteButton of elements.noteList.querySelectorAll(".note-delete-button")) {
    deleteButton.disabled = controls.deleteDisabled;
  }
}

function closeStaleHistoryConfirmation() {
  if (!historyConfirmationController?.pending) return;
  if (historyConfirmationController.revalidate()) return;
  if (elements.historyConfirmDialog.open) elements.historyConfirmDialog.close("cancel");
}

function canRunHistoryAction(operation) {
  const controls = currentHistoryControlState();
  if (
    !activeContext
    || !Number.isInteger(sidePanelRefresh.tabId)
    || activeContextTabId !== sidePanelRefresh.tabId
  ) return false;
  if (operation === "undo") return !controls.undoDisabled;
  if (operation === "redo") return !controls.redoDisabled;
  if (operation === "clear" || operation === "delete") return !controls.clearDisabled;
  return false;
}

async function runHistoryOperation(message) {
  const operation = historyOperationController.run(message);
  syncHistoryControls();
  const succeeded = await operation;
  syncHistoryControls();
  return succeeded;
}

function runConfirmedHistoryAction(action) {
  if (action.operation === "delete") {
    return runHistoryOperation({
      type: "DELETE_NOTE",
      noteId: action.noteId,
      sessionId: action.sessionId,
      tabId: action.tabId,
    });
  }
  return runHistoryOperation({
    type: "CLEAR_SESSION_NOTES",
    sessionId: action.sessionId,
    tabId: action.tabId,
  });
}

function confirmHistoryAction({ title, description }, action) {
  if (elements.historyConfirmDialog.open) return;
  if (!historyConfirmationController.open(action)) return;
  elements.historyConfirmTitle.textContent = title;
  elements.historyConfirmDescription.textContent = description;
  elements.historyConfirmDialog.returnValue = "";
  elements.historyConfirmDialog.showModal();
}

function whisperModelLabel(modelId) {
  return whisperStatus?.models.find((model) => model.id === modelId)?.label ?? t("currentModel");
}

function retranscriptionUnavailableReason(note) {
  if (!note.audioKey) return t("originalAudioUnavailable");
  if (!whisperStatus) return t("readingModelStatus");
  const selectedModelId = whisperStatus.selectedModelId;
  if (!whisperStatus.cachedModelIds.includes(selectedModelId)) return t("currentModelNotCached");
  if (["downloading", "recording", "transcribing"].includes(whisperStatus.whisperState)) {
    return t("voiceTaskInProgress");
  }
  return "";
}

function formatTranscriptionTime(createdAt) {
  return new Date(createdAt).toLocaleString(interfaceLanguage === "en" ? "en" : "zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function request(message) {
  const payload = ["GET_ACTIVE_STATE", "GET_FULL_YOUTUBE_TRANSCRIPT", "SEEK_VIDEO"].includes(message.type)
    && Number.isInteger(sidePanelRefresh.tabId)
    ? { ...message, tabId: sidePanelRefresh.tabId }
    : message;
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) throw new Error(response?.error ?? t("operationFailed"));
  return response;
}

function resetFullTranscript({ hide = false } = {}) {
  fullTranscriptGeneration += 1;
  fullTranscript = null;
  fullTranscriptLoading = false;
  fullTranscriptContextKey = "";
  elements.fullTranscriptPanel.hidden = hide;
  elements.fullTranscriptPanel.open = !hide;
  elements.fullTranscriptStatus.textContent = t("fullTranscriptWaiting");
  elements.fullTranscriptSearch.value = "";
  elements.fullTranscriptSearch.disabled = true;
  syncFullTranscriptDisplayToggle();
  elements.fullTranscriptRetry.disabled = true;
  elements.fullTranscriptList.replaceChildren();
  elements.fullTranscriptEmpty.textContent = t("fullTranscriptWaiting");
  elements.fullTranscriptEmpty.hidden = false;
}

function syncFullTranscriptDisplayToggle() {
  const mode = fullTranscriptGrouped
    ? t("fullTranscriptGroupedMode")
    : t("fullTranscriptIndividualMode");
  elements.fullTranscriptDisplayToggle.disabled = !fullTranscript;
  elements.fullTranscriptDisplayToggle.textContent = fullTranscriptGrouped
    ? t("fullTranscriptShowIndividual")
    : t("fullTranscriptGroupByFive");
  elements.fullTranscriptDisplayToggle.setAttribute("aria-pressed", String(fullTranscriptGrouped));
  elements.fullTranscriptDisplayToggle.setAttribute(
    "aria-label",
    t("fullTranscriptDisplayMode", { mode }),
  );
  elements.fullTranscriptDisplayToggle.title = t("fullTranscriptDisplayMode", { mode });
}

function renderFullTranscript() {
  const cues = fullTranscript?.cues ?? [];
  const visibleTranscript = transcriptDisplayCues(
    cues,
    elements.fullTranscriptSearch.value,
    { grouped: fullTranscriptGrouped },
  );
  const visibleCues = visibleTranscript.cues;
  elements.fullTranscriptList.replaceChildren();
  for (const cue of visibleCues) {
    const item = document.createElement("li");
    item.className = "full-transcript-cue";
    const timestamp = formatTranscriptTimeRange(cue);
    const time = document.createElement("button");
    time.className = "full-transcript-time";
    time.type = "button";
    time.dataset.seconds = String(cue.startMs / 1000);
    time.textContent = timestamp;
    time.setAttribute("aria-label", t("jumpToTimestamp", { timestamp }));
    const text = document.createElement("p");
    text.className = "full-transcript-text";
    text.textContent = cue.text;
    item.append(time, text);
    elements.fullTranscriptList.append(item);
  }
  elements.fullTranscriptEmpty.textContent = cues.length > 0
    ? t("fullTranscriptNoMatches")
    : t("fullTranscriptWaiting");
  elements.fullTranscriptEmpty.hidden = visibleCues.length > 0;
}

async function loadFullTranscript() {
  if (fullTranscriptLoading || !activeContext || activeContext.platform !== "youtube") return;
  const contextKey = `${sidePanelRefresh.tabId}:${activeContext.sessionId}`;
  const generation = ++fullTranscriptGeneration;
  fullTranscriptContextKey = contextKey;
  fullTranscriptLoading = true;
  fullTranscript = null;
  elements.fullTranscriptPanel.hidden = false;
  elements.fullTranscriptPanel.open = true;
  elements.fullTranscriptStatus.textContent = t("fullTranscriptLoading");
  elements.fullTranscriptSearch.value = "";
  elements.fullTranscriptSearch.disabled = true;
  syncFullTranscriptDisplayToggle();
  elements.fullTranscriptRetry.disabled = true;
  elements.fullTranscriptList.replaceChildren();
  elements.fullTranscriptEmpty.textContent = t("fullTranscriptLoadingDetail");
  elements.fullTranscriptEmpty.hidden = false;

  try {
    const response = await request({ type: "GET_FULL_YOUTUBE_TRANSCRIPT" });
    if (generation !== fullTranscriptGeneration || contextKey !== fullTranscriptContextKey) return;
    if (!response.transcript?.ok || response.transcript.cues.length === 0) {
      const messageKey = transcriptFailureMessageKey(response.transcript);
      elements.fullTranscriptStatus.textContent = t("fullTranscriptUnavailable");
      elements.fullTranscriptEmpty.textContent = t(messageKey);
      elements.fullTranscriptRetry.disabled = false;
      return;
    }
    fullTranscript = response.transcript;
    const coverage = transcriptCoverage(fullTranscript.cues);
    elements.fullTranscriptStatus.textContent = t("fullTranscriptLoaded", {
      count: fullTranscript.cues.length,
      coverage: formatTranscriptTimeRange(coverage),
      language: fullTranscript.label || fullTranscript.languageCode || t("unknownLanguage"),
    });
    elements.fullTranscriptSearch.disabled = false;
    syncFullTranscriptDisplayToggle();
    elements.fullTranscriptRetry.disabled = false;
    renderFullTranscript();
  } catch (error) {
    if (generation !== fullTranscriptGeneration || contextKey !== fullTranscriptContextKey) return;
    elements.fullTranscriptStatus.textContent = t("fullTranscriptUnavailable");
    elements.fullTranscriptEmpty.textContent = localizeRuntimeMessage(interfaceLanguage, error.message);
    elements.fullTranscriptRetry.disabled = false;
  } finally {
    if (generation === fullTranscriptGeneration) fullTranscriptLoading = false;
  }
}

function syncFullTranscriptContext() {
  if (!activeContext || activeContext.platform !== "youtube") {
    resetFullTranscript({ hide: true });
    return;
  }
  const contextKey = `${sidePanelRefresh.tabId}:${activeContext.sessionId}`;
  if (contextKey === fullTranscriptContextKey) return;
  resetFullTranscript();
  fullTranscriptContextKey = contextKey;
  void loadFullTranscript();
}

async function readMicrophonePermission() {
  const { microphoneReady: savedReady = false } = await chrome.storage.local.get({
    microphoneReady: false,
  });
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    if (microphonePermissionStatus !== status) {
      if (microphonePermissionStatus) microphonePermissionStatus.onchange = null;
      microphonePermissionStatus = status;
      microphonePermissionStatus.onchange = () => {
        microphoneReady = microphonePermissionStatus.state === "granted";
        void chrome.storage.local
          .set({ microphoneReady })
          .then(() => renderPermissionStatus());
      };
    }
    const ready = status.state === "granted";
    if (ready !== savedReady) await chrome.storage.local.set({ microphoneReady: ready });
    return { ready, state: status.state };
  } catch {
    return { ready: savedReady, state: savedReady ? "granted" : "prompt" };
  }
}

async function renderPermissionStatus({ expandIfNeeded = false } = {}) {
  const [screenshotGranted, microphone] = await Promise.all([
    chrome.permissions.contains({ origins: SCREENSHOT_ORIGINS }),
    readMicrophonePermission(),
  ]);
  microphoneReady = microphone.ready;

  elements.screenshotPermissionDetail.textContent = screenshotGranted
    ? t("screenshotPermissionGranted")
    : t("screenshotPermissionNeeded");
  elements.screenshotPermissionButton.textContent = screenshotGranted ? t("enabled") : t("enable");
  elements.screenshotPermissionButton.disabled = screenshotGranted;

  elements.microphonePermissionDetail.textContent = microphone.ready
    ? t("microphonePermissionGranted")
    : microphone.state === "denied"
      ? t("microphonePermissionDenied")
      : t("microphonePermissionNeeded");
  elements.microphonePermissionButton.textContent = microphone.ready ? t("authorized") : t("authorize");
  elements.microphonePermissionButton.disabled = microphone.ready;

  if (expandIfNeeded && (!screenshotGranted || !microphone.ready)) {
    elements.settings.open = true;
  }
}

async function openMicrophonePermissionPage() {
  await request({ type: "OPEN_MICROPHONE_PERMISSION_PAGE" });
}

function autoGrow() {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 260)}px`;
}

function closeScreenshotDialog() {
  if (elements.screenshotDialog.open) elements.screenshotDialog.close();
  elements.screenshotDialogImage.removeAttribute("src");
}

function appendAssetWarning(container, message) {
  const warning = document.createElement("span");
  warning.className = "note-asset-warning";
  warning.textContent = message;
  container.append(warning);
}

async function renderNoteAssets(note, container, generation) {
  try {
    const assets = await loadNoteAssets(note, {
      getAsset: (key) => repository.getAsset(key),
      registry: assetUrls,
      isCurrent: () => generation === renderGeneration,
      registryKeyPrefix: `note:${note.id}:`,
    });
    if (assets.stale) return;

    if (note.screenshotKey) {
      if (!assets.screenshotUrl) {
        appendAssetWarning(container, t("screenshotFileMissing"));
      } else {
        const button = document.createElement("button");
        button.className = "note-screenshot-button";
        button.type = "button";
        button.setAttribute("aria-label", t("enlargeScreenshot"));
        const image = document.createElement("img");
        image.className = "note-screenshot";
        image.loading = "lazy";
        image.alt = t("screenshotAlt");
        image.src = assets.screenshotUrl;
        button.append(image);
        button.addEventListener("click", () => {
          elements.screenshotDialogImage.src = image.src;
          if (!elements.screenshotDialog.open) elements.screenshotDialog.showModal();
        });
        container.append(button);
      }
    }

    if (note.audioKey) {
      if (!assets.audioUrl) {
        appendAssetWarning(container, t("audioFileMissing"));
      } else {
        const player = document.createElement("audio");
        player.className = "note-audio";
        player.controls = true;
        player.preload = "metadata";
        player.src = assets.audioUrl;
        container.append(player);
      }
    }
  } catch {
    if (generation !== renderGeneration) return;
    if (note.screenshotKey) {
      appendAssetWarning(container, t("screenshotFileMissing"));
    }
    if (note.audioKey) {
      appendAssetWarning(container, t("audioFileMissing"));
    }
  }
}

function renderNotes(notes, order = noteSortBinding.order) {
  currentNotes = notes;
  const generation = ++renderGeneration;
  closeScreenshotDialog();
  stopNoteMedia(elements.noteList);
  assetUrls.revokeAll();
  const saved = sortNotesForDisplay(
    currentNotes.filter((note) => note.status === "saved"),
    order,
  );
  elements.noteList.replaceChildren();
  elements.emptyNotes.hidden = saved.length > 0;
  elements.exportButton.disabled = saved.length === 0;

  for (const note of saved) {
    const item = document.createElement("li");
    item.className = "note-card";
    const header = document.createElement("div");
    header.className = "note-card-header";
    const time = document.createElement("a");
    time.className = "note-time";
    time.href = note.jumpUrl;
    time.target = "_blank";
    time.textContent = formatTimestamp(note.seconds);
    const kind = document.createElement("span");
    kind.className = "note-kind";
    kind.textContent = note.inputType === "voice" ? t("voiceNote") : t("textNote");
    const edit = document.createElement("button");
    edit.className = "note-edit-button";
    edit.type = "button";
    edit.textContent = t("edit");
    const deleteButton = document.createElement("button");
    deleteButton.className = "note-delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = t("delete");
    deleteButton.addEventListener("click", () => {
      if (!canRunHistoryAction("delete")) return;
      confirmHistoryAction({
        title: t("deleteNoteTitle"),
        description: t("deleteNoteDescription", {
          timestamp: formatTimestamp(note.seconds),
        }),
      }, { operation: "delete", noteId: note.id });
    });
    const actions = document.createElement("span");
    actions.className = "note-card-actions";
    actions.append(kind, edit, deleteButton);
    header.append(time, actions);
    item.append(header);

    const body = document.createElement("p");
    body.className = "note-body";
    body.textContent = note.body || (note.inputType === "voice" ? t("originalAudioSaved") : t("emptyNote"));
    item.append(body);
    const assets = document.createElement("div");
    assets.className = "note-assets";
    item.append(assets);
    void renderNoteAssets(note, assets, generation);
    inlineEditController.bind({
      noteId: note.id,
      button: edit,
      content: body,
      getInitialText: () => note.body ?? "",
      restore() {
        body.textContent = note.body || (note.inputType === "voice" ? t("originalAudioSaved") : t("emptyNote"));
      },
      save(text) {
        return request({
          type: "UPDATE_NOTE_BODY",
          noteId: note.id,
          body: text,
        });
      },
      applySaved(response) {
        note.body = response.note.body;
        body.textContent = note.body || (note.inputType === "voice" ? t("originalAudioSaved") : t("emptyNote"));
      },
    });
    const subtitleState = subtitleBlockState(note, subtitleSettings.enabled);
    if (subtitleState.visible) {
      const subtitleBlock = document.createElement("section");
      subtitleBlock.className = "note-subtitle";
      const subtitleHeader = document.createElement("div");
      subtitleHeader.className = "note-subtitle-header";
      const subtitleTitle = document.createElement("strong");
      subtitleTitle.textContent = t("leadInSubtitles");
      const subtitleEdit = document.createElement("button");
      subtitleEdit.className = "note-edit-button";
      subtitleEdit.type = "button";
      subtitleEdit.textContent = t("editSubtitles");
      const subtitle = document.createElement("p");
      subtitle.className = "note-subtitle-text";

      const renderSubtitle = () => {
        const state = subtitleBlockState(note, true);
        subtitle.textContent = state.empty
          ? t("subtitlesUnavailable")
          : state.text;
        subtitle.classList.toggle("is-empty", state.empty);
      };

      renderSubtitle();
      subtitleHeader.append(subtitleTitle, subtitleEdit);
      subtitleBlock.append(subtitleHeader, subtitle);
      item.append(subtitleBlock);

      inlineEditController.bind({
        noteId: note.id,
        button: subtitleEdit,
        content: subtitle,
        getInitialText: () => note.subtitleContext ?? "",
        restore: renderSubtitle,
        save(text) {
          return request({
            type: "UPDATE_NOTE_SUBTITLE",
            noteId: note.id,
            subtitleContext: text,
          });
        },
        applySaved(response) {
          note.subtitleContext = response.note.subtitleContext;
          renderSubtitle();
        },
      });
    }
    if (note.transcriptionStatus === "transcribing" || note.transcriptionStatus === "pending") {
      const pending = document.createElement("span");
      pending.className = "note-pending";
      pending.textContent = note.pendingTranscription
        ? t("transcribingWithModel", {
          model: whisperModelLabel(note.pendingTranscription.modelId),
        })
        : t("localTranscribing");
      item.append(pending);
    }
    if (note.inputType === "voice") {
      const retranscribe = document.createElement("button");
      retranscribe.className = "note-retranscribe-button";
      retranscribe.type = "button";
      retranscribe.textContent = t("retranscribe");
      const unavailableReason = retranscriptionUnavailableReason(note);
      retranscribe.disabled = Boolean(unavailableReason);
      retranscribe.title = unavailableReason;
      retranscribe.addEventListener("click", async () => {
        retranscribe.disabled = true;
        try {
          await request({ type: "RETRANSCRIBE_NOTE", noteId: note.id });
          await refresh();
        } catch (error) {
          showToast(error.message);
          await refresh();
        }
      });
      item.append(retranscribe);
      if (unavailableReason) {
        const reason = document.createElement("span");
        reason.className = "note-retranscribe-reason";
        reason.textContent = unavailableReason;
        item.append(reason);
      }
    }
    if ((note.transcriptionRuns?.length ?? 0) > 1) {
      const results = document.createElement("details");
      results.className = "note-transcription-results";
      const summary = document.createElement("summary");
      summary.textContent = t("viewTranscriptions", { count: note.transcriptionRuns.length });
      results.append(summary);
      for (const run of note.transcriptionRuns) {
        const result = document.createElement("div");
        result.className = "note-transcription-result";
        const metadata = document.createElement("span");
        metadata.className = "note-transcription-meta";
        metadata.textContent = `${whisperModelLabel(run.modelId)} · ${formatTranscriptionTime(run.createdAt)}`;
        const text = document.createElement("p");
        text.textContent = run.text || t("noRecognizedText");
        result.append(metadata, text);
        results.append(result);
      }
      item.append(results);
    }
    for (const warning of note.warnings ?? []) {
      const warningLine = document.createElement("span");
      warningLine.className = "note-pending";
      warningLine.textContent = localizeRuntimeMessage(interfaceLanguage, warning);
      item.append(warningLine);
    }
    elements.noteList.append(item);
  }
  syncHistoryControls();
}

async function refresh() {
  if (inlineEditController.blocked) {
    sidePanelRefresh.requestRefresh({ type: "SIDE_PANEL_REFRESH_REQUEST" });
    return;
  }
  await refreshNow();
}

async function refreshNow() {
  return refreshRunner.run();
}

refreshRunner = createSidePanelRefreshRunner({
  async load() {
    const response = await request({ type: "GET_ACTIVE_STATE" });
    const nextWhisperStatus = await request({ type: "GET_WHISPER_STATUS" })
      .catch(() => whisperStatus);
    return { nextWhisperStatus, response };
  },
  apply({ nextWhisperStatus, response }) {
    whisperStatus = nextWhisperStatus;
    if (
      activeContext?.sessionId !== response.context?.sessionId
      || activeContextTabId !== sidePanelRefresh.tabId
    ) {
      historyContextToken += 1;
    }
    activeContext = response.context;
    activeContextTabId = sidePanelRefresh.tabId;
    canUndo = response.history.canUndo;
    canRedo = response.history.canRedo;
    if (!activeContext) throw new Error(t("openSupportedVideo"));
    elements.videoTitle.textContent = activeContext.title;
    elements.videoUrl.href = activeContext.canonicalUrl;
    elements.videoUrl.hidden = false;
    elements.input.disabled = false;
    elements.voiceButton.disabled = false;
    renderNotes(response.notes);
    syncFullTranscriptContext();
  },
  applyError(error) {
    if (activeContext || activeContextTabId !== null) historyContextToken += 1;
    activeContext = null;
    activeContextTabId = null;
    canUndo = false;
    canRedo = false;
    elements.videoTitle.textContent = localizeRuntimeMessage(interfaceLanguage, error.message);
    elements.videoUrl.hidden = true;
    elements.input.disabled = true;
    elements.voiceButton.disabled = true;
    elements.exportButton.disabled = true;
    renderNotes([]);
    resetFullTranscript({ hide: true });
  },
  isBlocked: () => inlineEditController.blocked,
  defer() {
    sidePanelRefresh.requestRefresh({ type: "SIDE_PANEL_REFRESH_RESPONSE_DEFERRED" });
  },
});

async function beginTypedDraft() {
  if (currentDraft || draftPromise || !activeContext) return;
  draftPromise = request({ type: "BEGIN_TYPED_NOTE" });
  syncHistoryControls();
  try {
    const response = await draftPromise;
    currentDraft = response.note;
    elements.markerTime.textContent = formatTimestamp(currentDraft.seconds);
    elements.markerTime.hidden = false;
  } catch (error) {
    showToast(error.message);
    elements.input.blur();
  } finally {
    draftPromise = null;
    syncHistoryControls();
  }
}

async function commitTypedDraft() {
  if (draftPromise) await draftPromise.catch(() => {});
  if (!currentDraft) return;
  const noteId = currentDraft.id;
  const body = elements.input.value.trim();
  currentDraft = null;
  typedDraftSaving = true;
  elements.markerTime.hidden = true;
  elements.input.value = "";
  autoGrow();
  try {
    if (body) await request({ type: "COMMIT_TYPED_NOTE", noteId, body });
    else await request({ type: "CANCEL_NOTE", noteId });
    await refresh();
  } catch (error) {
    showToast(error.message);
  } finally {
    typedDraftSaving = false;
    syncHistoryControls();
  }
}

async function cancelTypedDraft() {
  if (draftPromise) await draftPromise.catch(() => {});
  if (!currentDraft) return;
  const noteId = currentDraft.id;
  currentDraft = null;
  typedDraftSaving = true;
  elements.input.value = "";
  elements.markerTime.hidden = true;
  autoGrow();
  try {
    await request({ type: "CANCEL_NOTE", noteId });
  } catch (error) {
    showToast(error.message);
  } finally {
    typedDraftSaving = false;
    syncHistoryControls();
  }
}

function setRecordingUi(active) {
  recording = active;
  syncHistoryControls();
  elements.recordingStatus.hidden = !active;
  elements.voiceButton.classList.toggle("is-recording", active);
  elements.voiceLabel.textContent = active ? t("releaseToStop") : t("holdToTalk");
  clearInterval(recordingInterval);
  clearTimeout(recordingTimeout);
  if (!active) return;
  recordingStartedAt = Date.now();
  const update = () => {
    const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
    elements.recordingTimer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  update();
  recordingInterval = setInterval(update, 250);
  recordingTimeout = setTimeout(() => void stopVoice("timeout"), 60_000);
}

async function startVoice() {
  if (recording || voiceStarting || !activeContext) return;
  voiceStarting = true;
  syncHistoryControls();
  try {
    if (!microphoneReady) {
      await openMicrophonePermissionPage();
      pendingVoiceStopReason = null;
      showToast(t("completeMicrophonePermission"));
      return;
    }
    await request({ type: "VOICE_START_REQUEST" });
    setRecordingUi(true);
    if (pendingVoiceStopReason) {
      const reason = pendingVoiceStopReason;
      pendingVoiceStopReason = null;
      await stopVoice(reason);
    }
  } catch (error) {
    pendingVoiceStopReason = null;
    showToast(error.message);
  } finally {
    voiceStarting = false;
    syncHistoryControls();
  }
}

async function stopVoice(reason = "button-release") {
  if (voiceStarting && !recording) {
    pendingVoiceStopReason = reason;
    return;
  }
  if (!recording) return;
  setRecordingUi(false);
  voiceStopping = true;
  syncHistoryControls();
  try {
    await request({ type: "VOICE_STOP_REQUEST", reason });
    await refresh();
  } catch (error) {
    showToast(error.message);
  } finally {
    voiceStopping = false;
    syncHistoryControls();
  }
}

function shortcutLabel(code) {
  const labels = {
    AltRight: t("shortcutRightAlt"),
    AltLeft: t("shortcutLeftAlt"),
    Space: t("shortcutSpace"),
  };
  return labels[code] ?? code;
}

async function renderWhisperStatus() {
  const status = await request({ type: "GET_WHISPER_STATUS" });
  whisperStatus = status;
  const labels = {
    disabled: t("whisperDisabled"),
    downloading: t("whisperDownloading"),
    ready: t("whisperReady"),
    recording: t("whisperRecording"),
    transcribing: t("whisperTranscribing"),
    error: t("whisperError", {
      error: localizeRuntimeMessage(
        interfaceLanguage,
        status.whisperError || t("unknownError"),
      ),
    }),
  };
  const selectedModelId = pendingWhisperModelId ?? status.selectedModelId;
  if (elements.whisperModelSelect.options.length !== status.models.length) {
    elements.whisperModelSelect.replaceChildren(...status.models.map((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.label}${model.recommended ? t("recommended") : ""}`;
      return option;
    }));
  }
  elements.whisperModelSelect.value = selectedModelId;
  const selectedModel = status.models.find(({ id }) => id === selectedModelId);
  const downloadingModel = status.models.find(({ id }) => id === status.download?.modelId);
  const busy = ["downloading", "recording", "transcribing"].includes(status.whisperState)
    || Boolean(status.download);
  const cached = status.cachedModelIds.includes(selectedModelId);
  elements.whisperDetail.textContent = downloadingModel
    ? t("modelDownloading", {
      model: downloadingModel.label,
      progress: `${Math.round((status.download.downloadedBytes ?? 0) / 1024 / 1024)} / ${Math.round(
        downloadingModel.size / 1024 / 1024,
      )} MiB`,
    })
    : labels[status.whisperState] ?? labels.disabled;
  elements.whisperModelAction.textContent = cached ? t("useThisModel") : t("downloadAndUse");
  elements.whisperModelSelect.disabled = busy;
  elements.whisperModelAction.disabled = busy;
  elements.whisperModelWarning.hidden = selectedModel?.experimental !== true;
  elements.whisperModelWarning.textContent = selectedModel?.experimental
    ? t("experimentalModelWarning")
    : "";
}

for (const button of elements.languageButtons) {
  const selected = button.dataset.interfaceLanguage === interfaceLanguage;
  button.setAttribute("aria-pressed", String(selected));
  button.addEventListener("click", async () => {
    if (selected) return;
    await writeInterfaceLanguage(chrome.storage.local, button.dataset.interfaceLanguage);
    location.reload();
  });
}

elements.input.addEventListener("focus", () => void beginTypedDraft());
elements.input.addEventListener("input", autoGrow);
elements.input.addEventListener("compositionstart", () => {
  isComposing = true;
});
elements.input.addEventListener("compositionend", () => {
  isComposing = false;
  if (commitAfterComposition) {
    commitAfterComposition = false;
    void commitTypedDraft();
  }
});
elements.input.addEventListener("blur", () => {
  if (isComposing) {
    commitAfterComposition = true;
    setTimeout(() => {
      if (!commitAfterComposition) return;
      isComposing = false;
      commitAfterComposition = false;
      void commitTypedDraft();
    }, 300);
  } else {
    void commitTypedDraft();
  }
});
elements.input.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    void cancelTypedDraft().then(() => elements.input.blur());
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void commitTypedDraft().then(() => elements.input.blur());
  }
});

elements.fullTranscriptSearch.addEventListener("input", renderFullTranscript);
elements.fullTranscriptDisplayToggle.addEventListener("click", () => {
  fullTranscriptGrouped = !fullTranscriptGrouped;
  syncFullTranscriptDisplayToggle();
  renderFullTranscript();
});
elements.fullTranscriptRetry.addEventListener("click", () => {
  void loadFullTranscript();
});
elements.fullTranscriptList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-seconds]");
  if (!button) return;
  const seconds = Number(button.dataset.seconds);
  if (!Number.isFinite(seconds)) return;
  void request({ type: "SEEK_VIDEO", seconds }).catch((error) => {
    showToast(error.message);
  });
});

elements.voiceButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  elements.voiceButton.setPointerCapture(event.pointerId);
  void startVoice();
});
elements.voiceButton.addEventListener("pointerup", (event) => {
  event.preventDefault();
  void stopVoice();
});
elements.voiceButton.addEventListener("pointercancel", () => void stopVoice("pointer-cancel"));

elements.screenshotPermissionButton.addEventListener("click", async () => {
  elements.screenshotPermissionButton.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: SCREENSHOT_ORIGINS });
    if (!granted) throw new Error(t("screenshotPermissionCanceled"));
    showToast(t("screenshotEnabled"));
  } catch (error) {
    showToast(error.message);
  } finally {
    await renderPermissionStatus();
  }
});

elements.microphonePermissionButton.addEventListener("click", async () => {
  elements.microphonePermissionButton.disabled = true;
  try {
    await openMicrophonePermissionPage();
    showToast(t("completeMicrophonePermission"));
  } catch (error) {
    showToast(error.message);
  } finally {
    await renderPermissionStatus();
  }
});

elements.subtitleEnabled.addEventListener("change", async () => {
  const previous = subtitleSettings;
  elements.subtitleWindowSeconds.disabled = !elements.subtitleEnabled.checked;
  try {
    await chrome.storage.local.set({
      subtitleEnabled: elements.subtitleEnabled.checked,
    });
  } catch (error) {
    elements.subtitleEnabled.checked = previous.enabled;
    elements.subtitleWindowSeconds.disabled = !previous.enabled;
    showToast(error.message);
  }
});

elements.subtitleWindowSeconds.addEventListener("change", async () => {
  const previous = subtitleSettings;
  try {
    await chrome.storage.local.set({
      subtitleWindowSeconds: Number(elements.subtitleWindowSeconds.value),
    });
  } catch (error) {
    elements.subtitleWindowSeconds.value = String(previous.windowSeconds);
    showToast(error.message);
  }
});

elements.screenshotDialogClose.addEventListener("click", () => {
  elements.screenshotDialog.close();
});
elements.screenshotDialog.addEventListener("click", (event) => {
  const bounds = elements.screenshotDialog.getBoundingClientRect();
  const outsideDialog = event.clientX < bounds.left
    || event.clientX > bounds.right
    || event.clientY < bounds.top
    || event.clientY > bounds.bottom;
  if (event.target === elements.screenshotDialog && outsideDialog) {
    elements.screenshotDialog.close();
  }
});
elements.screenshotDialog.addEventListener("close", () => {
  elements.screenshotDialogImage.removeAttribute("src");
});

elements.historyConfirmDialog.addEventListener("close", () => {
  if (elements.historyConfirmDialog.returnValue !== "confirm") {
    historyConfirmationController.cancel();
    return;
  }
  void historyConfirmationController.confirm();
});

elements.undoButton.addEventListener("click", () => {
  if (!canRunHistoryAction("undo")) return;
  void runHistoryOperation({
    type: "UNDO_NOTE_ACTION",
    sessionId: activeContext.sessionId,
    tabId: sidePanelRefresh.tabId,
  });
});

elements.redoButton.addEventListener("click", () => {
  if (!canRunHistoryAction("redo")) return;
  void runHistoryOperation({
    type: "REDO_NOTE_ACTION",
    sessionId: activeContext.sessionId,
    tabId: sidePanelRefresh.tabId,
  });
});

elements.clearButton.addEventListener("click", () => {
  if (!canRunHistoryAction("clear")) return;
  confirmHistoryAction({
    title: t("clearNotesTitle"),
    description: t("clearNotesDescription", { count: savedNoteCount() }),
  }, { operation: "clear" });
});

elements.exportButton.addEventListener("click", async () => {
  if (!activeContext) return;
  elements.exportButton.disabled = true;
  try {
    const result = await request({
      type: "EXPORT_SESSION",
      sessionId: activeContext.sessionId,
      language: interfaceLanguage,
    });
    showToast(t("exportComplete", { count: result.noteCount }));
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.exportButton.disabled = false;
  }
});

elements.whisperModelSelect.addEventListener("change", () => {
  pendingWhisperModelId = elements.whisperModelSelect.value;
  void renderWhisperStatus();
});

elements.whisperModelAction.addEventListener("click", async () => {
  elements.whisperModelAction.disabled = true;
  try {
    const status = await request({ type: "GET_WHISPER_STATUS" });
    const modelId = elements.whisperModelSelect.value;
    if (status.cachedModelIds.includes(modelId)) {
      await request({ type: "SELECT_WHISPER_MODEL", modelId });
      showToast(t("whisperModelChanged"));
    } else {
      const source = modelId === "base-q5_1"
        ? await request({ type: "CHECK_BUNDLED_MODEL" })
        : { bundled: false };
      if (!source.bundled) {
        const granted = await chrome.permissions.request({ origins: WHISPER_ORIGINS });
        if (!granted) throw new Error(t("modelDownloadPermissionDenied"));
      }
      await request({ type: "ENABLE_WHISPER", modelId });
      showToast(t("whisperEnabled"));
    }
    pendingWhisperModelId = null;
  } catch (error) {
    showToast(error.message);
  } finally {
    await renderWhisperStatus();
  }
});

elements.keyButton.addEventListener("click", () => {
  elements.keyButton.classList.add("is-listening");
  elements.keyButton.textContent = t("pressAKey");
  elements.keyButton.focus();
});
elements.keyButton.addEventListener("keydown", async (event) => {
  if (!elements.keyButton.classList.contains("is-listening")) return;
  event.preventDefault();
  if (event.code === "Escape") {
    elements.keyButton.classList.remove("is-listening");
    const { shortcutCode = "AltRight" } = await chrome.storage.local.get("shortcutCode");
    elements.keyButton.textContent = shortcutLabel(shortcutCode);
    return;
  }
  try {
    await request({ type: "SET_SHORTCUT", code: event.code });
    elements.keyButton.textContent = shortcutLabel(event.code);
    showToast(t("shortcutChanged", { shortcut: shortcutLabel(event.code) }));
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.keyButton.classList.remove("is-listening");
  }
});

document.addEventListener("keydown", (event) => {
  const operation = historyShortcut(event);
  if (!operation || !canRunHistoryAction(operation)) return;
  event.preventDefault();
  if (operation === "undo") {
    void runHistoryOperation({
      type: "UNDO_NOTE_ACTION",
      sessionId: activeContext.sessionId,
      tabId: sidePanelRefresh.tabId,
    });
  } else {
    void runHistoryOperation({
      type: "REDO_NOTE_ACTION",
      sessionId: activeContext.sessionId,
      tabId: sidePanelRefresh.tabId,
    });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (isSidePanelRefreshMessage(message)) {
    sidePanelRefresh.handleContextChanged(message);
  }
});

document.addEventListener("visibilitychange", () => {
  sidePanelRefresh.handleVisibilityChange(document.visibilityState === "visible");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local"
    && changes.interfaceLanguage?.newValue
    && changes.interfaceLanguage.newValue !== interfaceLanguage
  ) {
    location.reload();
    return;
  }
  if (area === "local" && (
    changes.whisperState
    || changes.whisperSelectedModel
    || changes.whisperDownloadModel
    || changes.whisperDownloadedBytes
  )) {
    void renderWhisperStatus();
  }
  if (area === "local" && changes.shortcutCode?.newValue) {
    elements.keyButton.textContent = shortcutLabel(changes.shortcutCode.newValue);
  }
  if (area === "local" && changes.noteSortOrder) {
    noteSortBinding.sync(changes.noteSortOrder.newValue);
  }
  if (area === "local" && changes.microphoneReady) {
    microphoneReady = changes.microphoneReady.newValue === true;
    void renderPermissionStatus();
  }
  if (area === "local" && (
    changes.subtitleEnabled
    || changes.subtitleWindowSeconds
  )) {
    subtitleSettings = normalizeSubtitleSettings({
      subtitleEnabled: changes.subtitleEnabled
        ? changes.subtitleEnabled.newValue
        : subtitleSettings.enabled,
      subtitleWindowSeconds: changes.subtitleWindowSeconds
        ? changes.subtitleWindowSeconds.newValue
        : subtitleSettings.windowSeconds,
    });
    syncSubtitleSettingsControls();
    sidePanelRefresh.requestRefresh({ type: "SUBTITLE_SETTINGS_CHANGED" });
  }
});

window.addEventListener("pagehide", () => {
  ++renderGeneration;
  ++fullTranscriptGeneration;
  closeScreenshotDialog();
  stopNoteMedia(elements.noteList);
  assetUrls.revokeAll();
  if (recording || voiceStarting) {
    void chrome.runtime.sendMessage({ type: "CANCEL_PENDING_VOICE", reason: "sidepanel-closed" });
  }
  if (currentDraft) {
    void chrome.runtime.sendMessage({ type: "CANCEL_NOTE", noteId: currentDraft.id });
  } else if (draftPromise) {
    void draftPromise.then((response) => chrome.runtime.sendMessage({
      type: "CANCEL_NOTE",
      noteId: response.note.id,
    })).catch(() => {});
  }
});

subtitleSettings = normalizeSubtitleSettings(
  await chrome.storage.local.get({
    subtitleEnabled: true,
    subtitleWindowSeconds: 20,
  }),
);
syncSubtitleSettingsControls();

await initializeSidepanel({
  storage: chrome.storage,
  onShortcutCode: (shortcutCode) => {
    elements.keyButton.textContent = shortcutLabel(shortcutCode);
  },
  noteSortBinding,
  sidepanelZoomBinding,
  setPanelContext: async () => {
    const panelContext = await request({ type: "GET_SIDEPANEL_CONTEXT" });
    sidePanelRefresh.setTabId(panelContext.tabId, panelContext.windowId);
  },
  refresh,
  renderWhisperStatus,
  renderPermissionStatus: () => renderPermissionStatus({ expandIfNeeded: true }),
});
