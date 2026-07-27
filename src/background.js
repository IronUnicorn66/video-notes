import { computeScreenshotCrop } from "./core/screenshot.js";
import { VideoNotesRepository } from "./core/storage.js";
import {
  createNoteHistoryCommandRouter,
  isNoteHistoryCommand,
} from "./core/note-history-commands.js";
import {
  STUDY_SOUND_EXTENSION_ID,
  noteHoldMessage,
} from "./core/study-sound-protocol.js";
import {
  DEFAULT_WHISPER_MODEL_ID,
  WHISPER_MODELS,
  WHISPER_ORIGINS,
  getWhisperModel,
} from "./core/model-config.js";
import {
  assertModelSwitchAllowed,
  createNoteTaskCoordinator,
} from "./core/whisper-state.js";
import { recoverWhisperState } from "./core/whisper-recovery.js";
import { createWhisperOperationLock } from "./core/whisper-operation.js";
import { createMicrophoneNavigation } from "./core/microphone-navigation.js";
import {
  canUseMicrophone,
  friendlyCaptureError,
  friendlyMicrophoneError,
  isMicrophonePermissionError,
} from "./core/media-permissions.js";
import {
  contextChangedSenderTab,
  sidePanelMessageForTabUpdate,
  sidePanelOptionsForTab,
  sidePanelTabIdForSender,
} from "./core/sidepanel-scope.js";
import { createTabMessenger } from "./core/tab-messaging.js";

const repository = new VideoNotesRepository();
const tabMessenger = createTabMessenger({
  tabs: chrome.tabs,
  scripting: chrome.scripting,
});
const microphoneNavigation = createMicrophoneNavigation({
  storageSession: chrome.storage.session,
  tabs: chrome.tabs,
  windows: chrome.windows,
});
const heartbeatTimers = new Map();
let cancelPendingVoice = false;
let offscreenCreationPromise = null;
let voiceStartPromise = null;
let voiceStopPromise = null;
let activeVoiceNote = null;
let whisperRecoveryPromise = Promise.resolve();
let microphonePermissionPagePromise = null;
let microphonePermissionTabId = null;
const whisperModelOperationLock = createWhisperOperationLock();
const coordinateNoteTranscription = createNoteTaskCoordinator();
const noteHistoryCommandRouter = createNoteHistoryCommandRouter({
  repository,
  getCurrentContext: currentPageContext,
  onTypedNoteCommitted: releaseMarker,
});

function logSidePanelConfigurationError(tab, error) {
  console.warn("配置标签页侧栏失败", tab?.id, error);
}

async function configureSidePanelForTab(tab) {
  try {
    await chrome.sidePanel.setOptions(sidePanelOptionsForTab(tab));
  } catch (error) {
    logSidePanelConfigurationError(tab, error);
  }
}

async function configureExistingSidePanels() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    console.warn("查询现有标签页以配置侧栏失败", error);
    return;
  }
  await Promise.all(tabs.map((tab) => configureSidePanelForTab(tab)));
}

function notifyActiveContextChanged(tabId) {
  if (!Number.isInteger(tabId)) return;
  void chrome.runtime.sendMessage({ type: "ACTIVE_CONTEXT_CHANGED", tabId }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      const settings = await chrome.storage.local.get([
        "shortcutCode",
        "whisperState",
        "whisperSelectedModel",
        "whisperModel",
      ]);
      await chrome.storage.local.set({
        shortcutCode: settings.shortcutCode ?? "AltRight",
        whisperState: settings.whisperState ?? "disabled",
        whisperSelectedModel: getWhisperModel(
          settings.whisperSelectedModel || settings.whisperModel || DEFAULT_WHISPER_MODEL_ID,
        ).id,
      });
      await configureExistingSidePanels();
    } catch (error) {
      console.warn("初始化侧栏失败", error);
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      await configureExistingSidePanels();
    } catch (error) {
      console.warn("启动时配置侧栏失败", error);
    }
  })();
});

chrome.tabs.onCreated.addListener((tab) => {
  void configureSidePanelForTab(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    void configureSidePanelForTab({ ...tab, id: tabId });
  }
  const refreshMessage = sidePanelMessageForTabUpdate(tabId, changeInfo, tab);
  if (refreshMessage) {
    void chrome.runtime.sendMessage(refreshMessage).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void (async () => {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
      await configureSidePanelForTab(tab);
      notifyActiveContextChanged(tabId);
    } catch (error) {
      logSidePanelConfigurationError(tab ?? { id: tabId }, error);
    }
  })();
});

async function activeSupportedTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("没有找到当前标签页");
  return tab;
}

async function targetTab(sender, requestedTabId) {
  if (sender.tab?.id) return sender.tab;
  if (Number.isInteger(requestedTabId)) return chrome.tabs.get(requestedTabId);
  return activeSupportedTab();
}

async function openMicrophonePermissionPage(returnTab) {
  await microphoneNavigation.rememberSource(returnTab);
  if (!microphonePermissionPagePromise) {
    microphonePermissionPagePromise = (async () => {
      const url = chrome.runtime.getURL("microphone-permission.html");
      if (microphonePermissionTabId !== null) {
        try {
          return await chrome.tabs.update(microphonePermissionTabId, { active: true });
        } catch {
          microphonePermissionTabId = null;
        }
      }
      const [existing] = await chrome.runtime.getContexts({
        contextTypes: ["TAB"],
        documentUrls: [url],
      });
      if (existing?.tabId >= 0) {
        microphonePermissionTabId = existing.tabId;
        await chrome.tabs.update(existing.tabId, { active: true });
        if (existing.windowId >= 0) {
          await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
        }
        return { tabId: existing.tabId };
      }
      const tab = await chrome.tabs.create({ url, active: true });
      microphonePermissionTabId = tab.id ?? null;
      return tab;
    })().finally(() => {
      microphonePermissionPagePromise = null;
    });
  }
  return microphonePermissionPagePromise;
}

async function sendToTab(tabId, message) {
  const response = await tabMessenger.send(tabId, message);
  if (!response?.ok) throw new Error(response?.error ?? "视频页面没有响应");
  return response;
}

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!offscreenCreationPromise) {
    offscreenCreationPromise = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "WORKERS", "BLOBS"],
      justification: "在本机录音、运行 Whisper Worker，并生成可下载的 ZIP 文件",
    }).finally(() => {
      offscreenCreationPromise = null;
    });
  }
  await offscreenCreationPromise;
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
  if (!response?.ok) throw new Error(response?.error ?? "本地处理页面没有响应");
  return response;
}

async function enqueueTranscription(noteId, modelId, source) {
  getWhisperModel(modelId);
  if (!["automatic", "manual"].includes(source)) throw new Error("未知转写来源");
  await sendToOffscreen({
    type: "TRANSCRIBE_NOTE",
    noteId,
    modelId,
    source,
  });
}

async function markTranscriptionFailure(noteId, error) {
  const warning = `转写失败：${error.message}`;
  await repository.updateNote(noteId, (note) => ({
    ...note,
    pendingTranscription: null,
    transcriptionStatus: "error",
    warnings: note.warnings?.includes(warning)
      ? note.warnings
      : [...(note.warnings ?? []), warning],
    updatedAt: Date.now(),
  })).catch(() => {});
}

async function queueTranscription(noteId, modelId, source) {
  getWhisperModel(modelId);
  if (!["automatic", "manual"].includes(source)) throw new Error("未知转写来源");
  const pendingTranscription = { modelId, source, queuedAt: Date.now() };
  await repository.updateNote(noteId, (note) => ({
    ...note,
    transcriptionStatus: "pending",
    pendingTranscription,
    updatedAt: Date.now(),
  }));
  void enqueueTranscription(noteId, modelId, source).catch((error) => (
    markTranscriptionFailure(noteId, error)
  ));
}

async function recoverTransientWhisperState() {
  const settings = await chrome.storage.local.get({
    whisperState: "disabled",
    whisperSelectedModel: "",
    whisperModel: "",
  });
  let processing = null;
  if (await chrome.offscreen.hasDocument()) {
    processing = await sendToOffscreen({ type: "GET_PROCESSING_STATE" }).catch(() => null);
  }
  const cacheStatus = await sendToOffscreen({ type: "GET_MODEL_CACHE_STATUS" });
  const cachedModelIds = cacheStatus.cachedModelIds;
  const selectedModelId = getWhisperModel(
    settings.whisperSelectedModel || settings.whisperModel || DEFAULT_WHISPER_MODEL_ID,
  ).id;
  const { whisperState, whisperError } = recoverWhisperState({
    whisperState: settings.whisperState,
    cachedModelIds,
    selectedModelId,
    processing,
  });

  const recovered = {
    whisperState,
    whisperSelectedModel: selectedModelId,
  };
  if (whisperError !== undefined) recovered.whisperError = whisperError;
  await chrome.storage.local.set(recovered);

  if (processing?.downloading) return;
  await chrome.permissions.remove({ origins: WHISPER_ORIGINS }).catch(() => false);
  const activeNoteIds = new Set(processing?.transcriptionNoteIds ?? []);
  const pending = (await repository.listPendingTranscriptions())
    .filter((note) => !activeNoteIds.has(note.id));
  if (pending.length === 0) return;
  for (const note of pending) {
    let pendingTranscription = note.pendingTranscription;
    if (!pendingTranscription) {
      pendingTranscription = {
        modelId: selectedModelId,
        source: (note.transcriptionRuns?.length ?? 0) > 0 ? "manual" : "automatic",
        queuedAt: Date.now(),
      };
      await repository.updateNote(note.id, (current) => ({
        ...current,
        transcriptionStatus: "pending",
        pendingTranscription,
        updatedAt: Date.now(),
      }));
    }
    if (!cachedModelIds.includes(pendingTranscription.modelId)) {
      await markTranscriptionFailure(note.id, new Error("待转写模型缓存已丢失，请重新下载"));
      continue;
    }
    void enqueueTranscription(
      note.id,
      pendingTranscription.modelId,
      pendingTranscription.source,
    ).catch((error) => markTranscriptionFailure(note.id, error));
  }
}

whisperRecoveryPromise = recoverTransientWhisperState().catch(async (error) => {
  await chrome.storage.local.set({ whisperState: "error", whisperError: error.message });
});

async function cropVisiblePlayer(tab, snapshot) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const sourceBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const crop = computeScreenshotCrop(
      snapshot.rect,
      snapshot.viewport,
      { width: bitmap.width, height: bitmap.height },
      1600,
    );
    const canvas = new OffscreenCanvas(crop.outputWidth, crop.outputHeight);
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(
      bitmap,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      crop.outputWidth,
      crop.outputHeight,
    );
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  } finally {
    bitmap.close();
  }
}

async function beginMarker(tab, inputType, { beforePause, onPrepared } = {}) {
  const markerId = crypto.randomUUID();
  const snapshot = await sendToTab(tab.id, {
    type: "PREPARE_MARKER",
    markerId,
    deferPause: Boolean(beforePause),
  });
  const now = Date.now();
  const session = {
    id: snapshot.context.sessionId,
    platform: snapshot.context.platform,
    videoId: snapshot.context.videoId,
    part: snapshot.context.part,
    title: snapshot.context.title,
    canonicalUrl: snapshot.context.canonicalUrl,
    createdAt: now,
    updatedAt: now,
  };
  const note = {
    id: markerId,
    sessionId: session.id,
    tabId: tab.id,
    seconds: snapshot.seconds,
    jumpUrl: snapshot.jumpUrl,
    inputType,
    body: "",
    transcriptionStatus: inputType === "voice" ? "pending" : "none",
    transcriptCandidate: "",
    transcriptionModelId: "",
    transcriptionRuns: [],
    pendingTranscription: null,
    subtitleContext: snapshot.subtitleContext,
    screenshotKey: "",
    audioKey: "",
    warnings: [],
    wasPlaying: snapshot.wasPlaying,
    studySoundLinked: false,
    userEditVersion: 0,
    status: inputType === "voice" ? "recording" : "draft",
    createdAt: now,
    updatedAt: now,
  };

  if (beforePause) {
    await beforePause(note);
    await sendToTab(tab.id, {
      type: "ACTIVATE_MARKER",
      markerId,
      wasPlaying: note.wasPlaying,
    });
  }
  const preparedTask = onPrepared ? Promise.resolve(onPrepared(note)) : Promise.resolve();
  const existingSession = await repository.getSession(session.id);
  if (existingSession) session.createdAt = existingSession.createdAt;
  await repository.putSession(session);

  try {
    const screenshot = await cropVisiblePlayer(tab, snapshot);
    note.screenshotKey = `images/${markerId}`;
    await repository.putAsset(note.screenshotKey, screenshot);
  } catch (error) {
    note.warnings.push(`截图失败：${friendlyCaptureError(error)}`);
  }
  await repository.putNote(note);
  await preparedTask;
  return { session, note };
}

async function releaseMarker(note, shouldNotifyStudySound = false) {
  const shouldCoordinate = shouldNotifyStudySound && note.studySoundLinked === true;
  let externalReleased = false;
  if (shouldCoordinate) {
    let shouldResumeMain = false;
    try {
      const eligibility = await sendToTab(note.tabId, {
        type: "GET_MARKER_RESUME_ELIGIBILITY",
        markerId: note.id,
      });
      shouldResumeMain = eligibility.shouldResume === true;
    } catch {
      shouldResumeMain = false;
    }
    externalReleased = await releaseStudySoundHold(note, shouldResumeMain);
  }
  try {
    const response = await sendToTab(note.tabId, {
      type: "RELEASE_MARKER",
      markerId: note.id,
      allowResume: !externalReleased,
    });
    return response.resumed;
  } catch {
    return false;
  }
}

async function cancelNote(noteId, fallbackNote = null) {
  const storedNote = await repository.getNote(noteId);
  const note = storedNote && fallbackNote
    ? {
        ...fallbackNote,
        ...storedNote,
        screenshotKey: fallbackNote.screenshotKey || storedNote.screenshotKey,
        audioKey: fallbackNote.audioKey || storedNote.audioKey,
      }
    : storedNote ?? fallbackNote;
  if (!note) return;
  if (storedNote) await repository.deleteNote(note.id);
  if (note.screenshotKey) await repository.deleteAsset(note.screenshotKey);
  if (note.audioKey) await repository.deleteAsset(note.audioKey);
  await releaseMarker(note, note.inputType === "voice");
}

async function externalStudySound(message) {
  return chrome.runtime.sendMessage(STUDY_SOUND_EXTENSION_ID, message);
}

async function acquireStudySoundHold(note) {
  try {
    const response = await externalStudySound(
      noteHoldMessage("NOTE_HOLD_ACQUIRE", {
        leaseId: note.id,
        tabId: note.tabId,
        shouldResumeMain: note.wasPlaying,
      }),
    );
    if (!response?.ok || response.protocolVersion !== 1) throw new Error("协议不兼容");
    const timer = setInterval(() => {
      void externalStudySound(
        noteHoldMessage("NOTE_HOLD_HEARTBEAT", { leaseId: note.id, tabId: note.tabId }),
      ).catch(() => {});
    }, 30_000);
    heartbeatTimers.set(note.id, timer);
    note.studySoundLinked = true;
    return true;
  } catch {
    note.studySoundLinked = false;
    const { studySoundWarningShown = false } = await chrome.storage.local.get(
      "studySoundWarningShown",
    );
    if (!studySoundWarningShown) {
      note.warnings.push("背景音未联动静音");
      await chrome.storage.local.set({ studySoundWarningShown: true });
    }
    return false;
  }
}

async function releaseStudySoundHold(note, shouldResumeMain) {
  clearInterval(heartbeatTimers.get(note.id));
  heartbeatTimers.delete(note.id);
  try {
    const response = await externalStudySound(
      noteHoldMessage("NOTE_HOLD_RELEASE", {
        leaseId: note.id,
        tabId: note.tabId,
        shouldResumeMain,
      }),
    );
    return response?.ok === true && response.protocolVersion === 1;
  } catch {
    // StudySound 缺失时视频笔记仍应完成自己的恢复流程。
    return false;
  }
}

async function startVoice(tab) {
  if (voiceStartPromise || voiceStopPromise) throw new Error("录音正在启动或保存，请稍候");
  voiceStartPromise = startVoiceUnlocked(tab);
  try {
    return await voiceStartPromise;
  } finally {
    voiceStartPromise = null;
  }
}

async function startVoiceUnlocked(tab) {
  cancelPendingVoice = false;
  const { microphoneReady = false } = await chrome.storage.local.get({ microphoneReady: false });
  if (!microphoneReady) {
    await openMicrophonePermissionPage(tab);
    throw new Error("请在新页面完成麦克风授权");
  }
  const microphonePermission = await sendToOffscreen({ type: "GET_MICROPHONE_PERMISSION" });
  if (!canUseMicrophone(microphoneReady, microphonePermission.state)) {
    await chrome.storage.local.set({ microphoneReady: false });
    await openMicrophonePermissionPage(tab);
    throw new Error("请在新页面完成麦克风授权");
  }
  const recording = await sendToOffscreen({ type: "GET_RECORDING_STATE" });
  if (recording.recording) throw new Error("已有录音正在进行");
  let preparedNote = null;
  try {
    const { note, session } = await beginMarker(tab, "voice", {
      beforePause(noteToPrepare) {
        preparedNote = noteToPrepare;
        activeVoiceNote = noteToPrepare;
        return acquireStudySoundHold(noteToPrepare);
      },
      onPrepared(noteToPrepare) {
        preparedNote = noteToPrepare;
        return sendToOffscreen({ type: "START_RECORDING", noteId: noteToPrepare.id });
      },
    });
    if (cancelPendingVoice) {
      cancelPendingVoice = false;
      await stopVoice("sidepanel-closed");
      return { note, session, canceled: true };
    }
    void chrome.runtime.sendMessage({
      type: "VOICE_STATE_CHANGED",
      recording: true,
      noteId: note.id,
      tabId: note.tabId,
    }).catch(() => {});
    return { note, session };
  } catch (error) {
    const permissionError = isMicrophonePermissionError(error);
    if (permissionError) {
      await chrome.storage.local.set({ microphoneReady: false });
    }
    const state = await sendToOffscreen({ type: "GET_RECORDING_STATE" }).catch(() => ({}));
    const noteId = state.noteId ?? preparedNote?.id;
    if (state.recording) await sendToOffscreen({ type: "ABORT_RECORDING" }).catch(() => {});
    if (noteId) await cancelNote(noteId, preparedNote);
    activeVoiceNote = null;
    if (permissionError) await openMicrophonePermissionPage(tab).catch(() => {});
    throw new Error(friendlyMicrophoneError(error));
  }
}

async function stopVoice(reason) {
  if (voiceStopPromise) return voiceStopPromise;
  voiceStopPromise = stopVoiceUnlocked(reason);
  try {
    return await voiceStopPromise;
  } finally {
    voiceStopPromise = null;
  }
}

async function stopVoiceUnlocked(reason) {
  const fallbackNote = activeVoiceNote;
  let result;
  try {
    result = await sendToOffscreen({ type: "STOP_RECORDING", reason });
  } catch (error) {
    if (fallbackNote) {
      const note = await repository.getNote(fallbackNote.id) ?? fallbackNote;
      const warning = `录音保存失败：${error.message}`;
      const savedNote = await repository.commitSavedNote(note.id, {
        status: "saved",
        transcriptionStatus: "error",
        warnings: [...(note.warnings ?? []), warning],
      });
      await releaseMarker(savedNote, true);
      await finishVoiceUi(savedNote);
    }
    activeVoiceNote = null;
    throw error;
  }
  const note = await repository.getNote(result.noteId);
  if (!note) throw new Error("录音对应的标记已丢失");
  await releaseMarker(note, true);
  activeVoiceNote = null;
  await finishVoiceUi(note);

  if (result.whisperReady) {
    const { whisperSelectedModel = "" } = await chrome.storage.local.get({
      whisperSelectedModel: "",
    });
    await queueTranscription(
      note.id,
      getWhisperModel(whisperSelectedModel || DEFAULT_WHISPER_MODEL_ID).id,
      "automatic",
    );
  }
  return { noteId: note.id };
}

async function finishVoiceUi(note) {
  void sendToTab(note.tabId, {
    type: "FORCE_STOP_RECORDING",
    reason: "recording-ended",
  }).catch(() => {});
  void chrome.runtime.sendMessage({
    type: "VOICE_STATE_CHANGED",
    recording: false,
    noteId: note.id,
    tabId: note.tabId,
  }).catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const exists = await chrome.offscreen.hasDocument();
    const recording = exists
      ? await sendToOffscreen({ type: "GET_RECORDING_STATE" }).catch(() => null)
      : null;
    let note = activeVoiceNote?.tabId === tabId ? activeVoiceNote : null;
    if (!note && recording?.noteId) {
      const stored = await repository.getNote(recording.noteId);
      if (stored?.tabId === tabId) note = stored;
    }
    if (!note) return;
    if (recording?.recording || recording?.stopping) {
      await stopVoice("tab-closed");
      return;
    }
    if (recording?.starting) await sendToOffscreen({ type: "ABORT_RECORDING" }).catch(() => {});
    await cancelNote(note.id, note);
    activeVoiceNote = null;
  })().catch(() => {});
});

async function currentPageContext({ sender, tabId }) {
  const tab = await targetTab(sender, tabId);
  const response = await sendToTab(tab.id, { type: "GET_PAGE_CONTEXT" });
  return response.context ?? null;
}

async function enableWhisper(modelId = DEFAULT_WHISPER_MODEL_ID) {
  return whisperModelOperationLock.run(() => enableWhisperCore(modelId));
}

async function enableWhisperCore(modelId) {
  await whisperRecoveryPromise;
  const model = getWhisperModel(modelId);
  const processing = await sendToOffscreen({ type: "GET_PROCESSING_STATE" });
  assertModelSwitchAllowed({
    whisperState: processing.downloading
      ? "downloading"
      : processing.recording || processing.starting || processing.stopping
        ? "recording"
        : processing.transcriptionNoteIds.length > 0
          ? "transcribing"
          : "ready",
    modelDownloading: processing.downloading,
    transcriptionCount: processing.transcriptionNoteIds.length,
    recording: processing.recording || processing.starting || processing.stopping,
  });
  try {
    await chrome.storage.local.set({ whisperState: "downloading", whisperError: "" });
    const result = await sendToOffscreen({ type: "DOWNLOAD_MODEL", modelId: model.id });
    await chrome.storage.local.set({ whisperState: "ready", whisperSelectedModel: result.model });
    return result;
  } catch (error) {
    await chrome.storage.local.set({ whisperState: "error", whisperError: error.message });
    throw error;
  } finally {
    await chrome.permissions.remove({ origins: WHISPER_ORIGINS }).catch(() => false);
  }
}

async function selectWhisperModel(modelId) {
  return whisperModelOperationLock.run(() => selectWhisperModelCore(modelId));
}

async function selectWhisperModelCore(modelId) {
  await whisperRecoveryPromise;
  getWhisperModel(modelId);
  const processing = await sendToOffscreen({ type: "GET_PROCESSING_STATE" });
  assertModelSwitchAllowed({
    whisperState: processing.downloading
      ? "downloading"
      : processing.recording || processing.starting || processing.stopping
        ? "recording"
        : processing.transcriptionNoteIds.length > 0
          ? "transcribing"
          : "ready",
    modelDownloading: processing.downloading,
    transcriptionCount: processing.transcriptionNoteIds.length,
    recording: processing.recording || processing.starting || processing.stopping,
  });
  return sendToOffscreen({ type: "SELECT_WHISPER_MODEL", modelId });
}

async function handleMessage(message, sender) {
  if (isNoteHistoryCommand(message.type)) {
    return noteHistoryCommandRouter(message, { sender, tabId: message.tabId });
  }
  switch (message.type) {
    case "OFFSCREEN_STORAGE_GET":
      assertOffscreenSender(sender);
      return { values: await chrome.storage.local.get(message.keys) };
    case "OFFSCREEN_STORAGE_SET":
      assertOffscreenSender(sender);
      await chrome.storage.local.set(message.values);
      return {};
    case "OFFSCREEN_STORAGE_REMOVE":
      assertOffscreenSender(sender);
      await chrome.storage.local.remove(message.keys);
      return {};
    case "OFFSCREEN_DOWNLOAD":
      assertOffscreenSender(sender);
      return {
        downloadId: await chrome.downloads.download({
          url: message.url,
          filename: message.filename,
          saveAs: true,
        }),
      };
    case "GET_SIDEPANEL_CONTEXT": {
      const [contexts, activeTab] = await Promise.all([
        chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }),
        activeSupportedTab(),
      ]);
      const tabId = sidePanelTabIdForSender(sender, contexts, activeTab.id);
      if (tabId === null) throw new Error("无法确定侧栏所属标签页");
      return { tabId };
    }
    case "BEGIN_TYPED_NOTE": {
      const tab = await targetTab(sender);
      return beginMarker(tab, "typed");
    }
    case "CANCEL_NOTE":
      await cancelNote(message.noteId);
      return {};
    case "VOICE_START_REQUEST": {
      const tab = await targetTab(sender);
      return startVoice(tab);
    }
    case "OPEN_MICROPHONE_PERMISSION_PAGE": {
      const tab = await targetTab(sender);
      return openMicrophonePermissionPage(tab);
    }
    case "MICROPHONE_PERMISSION_GRANTED":
      if (sender.url !== chrome.runtime.getURL("microphone-permission.html")) {
        throw new Error("麦克风授权完成消息来源无效");
      }
      return microphoneNavigation.returnToSource();
    case "VOICE_STOP_REQUEST":
      return stopVoice(message.reason);
    case "CANCEL_PENDING_VOICE": {
      cancelPendingVoice = true;
      const state = await sendToOffscreen({ type: "GET_RECORDING_STATE" });
      if (state.recording) await stopVoice(message.reason ?? "sidepanel-closed");
      else if (state.starting) await sendToOffscreen({ type: "ABORT_RECORDING" });
      return {};
    }
    case "RECORDING_TIMEOUT":
      if (sender.url !== chrome.runtime.getURL("offscreen.html")) {
        throw new Error("录音超时消息来源无效");
      }
      return stopVoice("timeout");
    case "RETRANSCRIBE_NOTE": {
      await whisperRecoveryPromise;
      return coordinateNoteTranscription(message.noteId, async () => {
        const note = await repository.getNote(message.noteId);
        if (note?.inputType !== "voice" || !note.audioKey) {
          throw new Error("该标记没有可重新转写的原始录音");
        }
        if (note.pendingTranscription || ["pending", "transcribing"].includes(note.transcriptionStatus)) {
          throw new Error("该标记正在转写，请等待完成后再试");
        }
        const processing = await sendToOffscreen({ type: "GET_PROCESSING_STATE" });
        if (
          processing.downloading
          || processing.recording
          || processing.starting
          || processing.stopping
          || processing.transcriptionNoteIds.length > 0
        ) {
          throw new Error("请等待当前语音任务结束后再重新转写");
        }
        const [settings, cacheStatus] = await Promise.all([
          chrome.storage.local.get({ whisperSelectedModel: "" }),
          sendToOffscreen({ type: "GET_MODEL_CACHE_STATUS" }),
        ]);
        const modelId = getWhisperModel(
          settings.whisperSelectedModel || DEFAULT_WHISPER_MODEL_ID,
        ).id;
        if (!cacheStatus.cachedModelIds.includes(modelId)) {
          throw new Error("当前模型尚未缓存，请先下载并启用");
        }
        await queueTranscription(note.id, modelId, "manual");
        return {};
      });
    }
    case "ENABLE_WHISPER":
      return enableWhisper(message.modelId);
    case "SELECT_WHISPER_MODEL":
      return selectWhisperModel(message.modelId);
    case "CHECK_BUNDLED_MODEL":
      return sendToOffscreen({ type: "CHECK_BUNDLED_MODEL" });
    case "GET_WHISPER_STATUS":
      await whisperRecoveryPromise;
      {
        const [settings, processing, cacheStatus] = await Promise.all([
          chrome.storage.local.get([
            "whisperState",
            "whisperError",
            "whisperSelectedModel",
            "whisperDownloadModel",
            "whisperDownloadedBytes",
          ]),
          sendToOffscreen({ type: "GET_PROCESSING_STATE" }),
          sendToOffscreen({ type: "GET_MODEL_CACHE_STATUS" }),
        ]);
        const whisperSelectedModel = getWhisperModel(
          settings.whisperSelectedModel || DEFAULT_WHISPER_MODEL_ID,
        ).id;
        return {
          whisperState: settings.whisperState,
          whisperError: settings.whisperError,
          selectedModelId: whisperSelectedModel,
          loadedModelId: processing.loadedModelId,
          cachedModelIds: cacheStatus.cachedModelIds,
          download: processing.downloading
            ? {
                modelId: settings.whisperDownloadModel,
                downloadedBytes: settings.whisperDownloadedBytes,
              }
            : null,
          models: WHISPER_MODELS.map(({ id, label, size, recommended, experimental }) => ({
            id,
            label,
            size,
            recommended: Boolean(recommended),
            experimental: Boolean(experimental),
          })),
        };
      }
    case "SET_SHORTCUT":
      await chrome.storage.local.set({ shortcutCode: message.code });
      return { code: message.code };
    case "EXPORT_SESSION":
      return sendToOffscreen({ type: "EXPORT_SESSION", sessionId: message.sessionId });
    case "CONTEXT_CHANGED": {
      const tab = contextChangedSenderTab(sender);
      if (!tab) {
        console.warn("视频上下文变化缺少有效发送标签页");
        return {};
      }
      await configureSidePanelForTab(tab);
      notifyActiveContextChanged(tab.id);
      return {};
    }
    default:
      return undefined;
  }
}

function assertOffscreenSender(sender) {
  if (sender.url !== chrome.runtime.getURL("offscreen.html")) {
    throw new Error("隐藏页消息来源无效");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") return false;
  void handleMessage(message, sender).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});
