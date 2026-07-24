import { computeScreenshotCrop } from "./core/screenshot.js";
import { VideoNotesRepository } from "./core/storage.js";
import {
  STUDY_SOUND_EXTENSION_ID,
  noteHoldMessage,
} from "./core/study-sound-protocol.js";
import { WHISPER_MODEL, WHISPER_ORIGINS } from "./core/model-config.js";
import {
  canUseMicrophone,
  friendlyCaptureError,
  friendlyMicrophoneError,
  isMicrophonePermissionError,
} from "./core/media-permissions.js";

const repository = new VideoNotesRepository();
const heartbeatTimers = new Map();
let cancelPendingVoice = false;
let offscreenCreationPromise = null;
let voiceStartPromise = null;
let voiceStopPromise = null;
let activeVoiceNote = null;
let whisperRecoveryPromise = Promise.resolve();

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const settings = await chrome.storage.local.get(["shortcutCode", "whisperState"]);
  await chrome.storage.local.set({
    shortcutCode: settings.shortcutCode ?? "AltRight",
    whisperState: settings.whisperState ?? "disabled",
  });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function activeSupportedTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("没有找到当前标签页");
  return tab;
}

async function targetTab(sender) {
  return sender.tab?.id ? sender.tab : activeSupportedTab();
}

async function sendToTab(tabId, message) {
  const response = await chrome.tabs.sendMessage(tabId, message);
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

async function hasLocalWhisperModel() {
  const cached = await (await caches.open(WHISPER_MODEL.cacheName)).match(WHISPER_MODEL.url);
  if (cached) return true;
  try {
    return (await fetch(chrome.runtime.getURL(`models/${WHISPER_MODEL.filename}`))).ok;
  } catch {
    return false;
  }
}

async function recoverTransientWhisperState() {
  const settings = await chrome.storage.local.get({
    whisperState: "disabled",
    whisperModel: "",
  });
  let processing = null;
  if (await chrome.offscreen.hasDocument()) {
    processing = await sendToOffscreen({ type: "GET_PROCESSING_STATE" }).catch(() => null);
  }
  const modelAvailable = processing?.modelCached ?? await hasLocalWhisperModel();
  const transientStates = new Set(["downloading", "recording", "transcribing"]);
  let whisperState = settings.whisperState;
  let whisperError;

  if (processing?.downloading) whisperState = "downloading";
  else if (processing?.recording || processing?.starting || processing?.stopping) {
    whisperState = "recording";
  } else if (processing?.transcriptionNoteIds?.length) whisperState = "transcribing";
  else if (transientStates.has(whisperState)) {
    whisperState = modelAvailable ? "ready" : "error";
    if (!modelAvailable) whisperError = "上次本地语音任务中断，请重新启用";
  } else if (settings.whisperModel && !modelAvailable) {
    whisperState = "error";
    whisperError = "本地语音模型缓存已丢失，请重新启用";
  }

  const recovered = {
    whisperState,
    whisperModel: modelAvailable ? WHISPER_MODEL.id : "",
  };
  if (whisperError !== undefined) recovered.whisperError = whisperError;
  else if (whisperState === "ready") recovered.whisperError = "";
  await chrome.storage.local.set(recovered);

  if (!modelAvailable || processing?.downloading) return;
  await chrome.permissions.remove({ origins: WHISPER_ORIGINS }).catch(() => false);
  const activeNoteIds = new Set(processing?.transcriptionNoteIds ?? []);
  const pending = (await repository.listPendingTranscriptions())
    .filter((note) => !activeNoteIds.has(note.id));
  if (pending.length === 0) return;
  await chrome.storage.local.set({ whisperState: "transcribing", whisperError: "" });
  for (const note of pending) {
    void sendToOffscreen({ type: "TRANSCRIBE_NOTE", noteId: note.id }).catch(() => {});
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
  if (!microphoneReady) throw new Error("请先在侧栏的权限设置中授权麦克风");
  const microphonePermission = await sendToOffscreen({ type: "GET_MICROPHONE_PERMISSION" });
  if (!canUseMicrophone(microphoneReady, microphonePermission.state)) {
    await chrome.storage.local.set({ microphoneReady: false });
    throw new Error("请先在侧栏的权限设置中授权麦克风");
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
    void chrome.runtime.sendMessage({ type: "VOICE_STATE_CHANGED", recording: true, noteId: note.id }).catch(() => {});
    return { note, session };
  } catch (error) {
    if (isMicrophonePermissionError(error)) {
      await chrome.storage.local.set({ microphoneReady: false });
    }
    const state = await sendToOffscreen({ type: "GET_RECORDING_STATE" }).catch(() => ({}));
    const noteId = state.noteId ?? preparedNote?.id;
    if (state.recording) await sendToOffscreen({ type: "ABORT_RECORDING" }).catch(() => {});
    if (noteId) await cancelNote(noteId, preparedNote);
    activeVoiceNote = null;
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
      note.status = "saved";
      note.transcriptionStatus = "error";
      note.warnings = [...(note.warnings ?? []), `录音保存失败：${error.message}`];
      note.updatedAt = Date.now();
      await repository.putNote(note);
      await releaseMarker(note, true);
      await finishVoiceUi(note);
    }
    activeVoiceNote = null;
    throw error;
  }
  const note = await repository.getNote(result.noteId);
  if (!note) throw new Error("录音对应的标记已丢失");
  note.audioKey = result.audioKey;
  note.status = "saved";
  note.updatedAt = Date.now();
  note.transcriptionStatus = result.whisperReady ? "transcribing" : "disabled";
  await repository.putNote(note);
  await releaseMarker(note, true);
  activeVoiceNote = null;
  await finishVoiceUi(note);

  if (result.whisperReady) {
    void sendToOffscreen({ type: "TRANSCRIBE_NOTE", noteId: note.id }).catch((error) => {
      const warning = `转写失败：${error.message}`;
      return repository.updateNote(note.id, (latest) => ({
        ...latest,
        transcriptionStatus: "error",
        warnings: latest.warnings?.includes(warning)
          ? latest.warnings
          : [...(latest.warnings ?? []), warning],
        updatedAt: Date.now(),
      })).catch(() => {});
    });
  }
  return { noteId: note.id };
}

async function finishVoiceUi(note) {
  void sendToTab(note.tabId, {
    type: "FORCE_STOP_RECORDING",
    reason: "recording-ended",
  }).catch(() => {});
  void chrome.runtime.sendMessage({ type: "VOICE_STATE_CHANGED", recording: false, noteId: note.id }).catch(() => {});
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

async function currentContextAndNotes(sender) {
  const tab = await targetTab(sender);
  const response = await sendToTab(tab.id, { type: "GET_PAGE_CONTEXT" });
  const context = response.context;
  if (!context) return { context: null, notes: [] };
  return { context, notes: await repository.listNotes(context.sessionId) };
}

async function enableWhisper() {
  await whisperRecoveryPromise;
  const source = await sendToOffscreen({ type: "CHECK_BUNDLED_MODEL" });
  const granted = source.bundled || await chrome.permissions.contains({ origins: WHISPER_ORIGINS });
  if (!granted) throw new Error("未授权下载本地语音模型");
  await chrome.storage.local.set({ whisperState: "downloading", whisperError: "" });
  try {
    const result = await sendToOffscreen({ type: "DOWNLOAD_MODEL" });
    await chrome.storage.local.set({ whisperState: "ready", whisperModel: result.model });
    await chrome.permissions.remove({ origins: WHISPER_ORIGINS });
    return result;
  } catch (error) {
    await chrome.storage.local.set({ whisperState: "error", whisperError: error.message });
    throw error;
  }
}

async function handleMessage(message, sender) {
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
    case "GET_ACTIVE_STATE":
      return currentContextAndNotes(sender);
    case "BEGIN_TYPED_NOTE": {
      const tab = await targetTab(sender);
      return beginMarker(tab, "typed");
    }
    case "COMMIT_TYPED_NOTE": {
      const note = await repository.getNote(message.noteId);
      if (!note) throw new Error("待保存标记不存在");
      note.body = String(message.body ?? "").trim();
      note.userEditVersion += 1;
      note.status = "saved";
      note.updatedAt = Date.now();
      await repository.putNote(note);
      await releaseMarker(note);
      return { note };
    }
    case "UPDATE_NOTE_BODY": {
      const note = await repository.updateNote(message.noteId, (current) => ({
        ...current,
        body: String(message.body ?? "").trim(),
        userEditVersion: (current.userEditVersion ?? 0) + 1,
        updatedAt: Date.now(),
      }));
      return { note };
    }
    case "CANCEL_NOTE":
      await cancelNote(message.noteId);
      return {};
    case "VOICE_START_REQUEST": {
      const tab = await targetTab(sender);
      return startVoice(tab);
    }
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
    case "ENABLE_WHISPER":
      return enableWhisper();
    case "CHECK_BUNDLED_MODEL":
      return sendToOffscreen({ type: "CHECK_BUNDLED_MODEL" });
    case "GET_WHISPER_STATUS":
      await whisperRecoveryPromise;
      return chrome.storage.local.get(["whisperState", "whisperError", "whisperModel"]);
    case "SET_SHORTCUT":
      await chrome.storage.local.set({ shortcutCode: message.code });
      return { code: message.code };
    case "EXPORT_SESSION":
      return sendToOffscreen({ type: "EXPORT_SESSION", sessionId: message.sessionId });
    case "CONTEXT_CHANGED":
      void chrome.runtime.sendMessage({ type: "ACTIVE_CONTEXT_CHANGED" }).catch(() => {});
      return {};
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
