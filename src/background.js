import { createFullTranscriptCacheLoader, cachedFullTranscriptForContext } from "./core/full-transcript-cache.js";
import { friendlyCaptureError } from "./core/media-permissions.js";
import { computeScreenshotCrop } from "./core/screenshot.js";
import { VideoNotesRepository } from "./core/storage.js";
import { captureYoutubePlayerTranscript } from "./core/youtube-transcript-capture.js";
import {
  shouldAttemptYoutubePlayerCapture,
  transcriptResultAfterPlayerCapture,
} from "./core/youtube-full-transcript.js";
import {
  createNoteHistoryCommandRouter,
  isNoteHistoryCommand,
} from "./core/note-history-commands.js";
import {
  activeSidePanelRequestTabId,
  activeContextChangedMessage,
  activateStandaloneTargetTab,
  contextChangedSenderTab,
  createActiveTabActivationHandler,
  createCurrentPageContextReader,
  createExistingSidePanelOptionsConfigurator,
  createSidePanelContextResolver,
  sidePanelMessageForTabUpdate,
  sidePanelOptionsForTab,
  sidePanelRequestTabIdForSender,
  sidePanelTabIdForSender,
  standalonePanelRequestTabId,
} from "./core/sidepanel-scope.js";
import { createStandaloneWindowManager } from "./core/standalone-window.js";
import { createTabMessenger } from "./core/tab-messaging.js";
import { clearLegacyCloudTranslationSettings } from "./core/local-only-migration.js";

const repository = new VideoNotesRepository();
const tabMessenger = createTabMessenger({
  tabs: chrome.tabs,
  scripting: chrome.scripting,
});
let offscreenCreationPromise = null;
const noteHistoryCommandRouter = createNoteHistoryCommandRouter({
  repository,
  getCurrentContext: currentPageContext,
  onTypedNoteCommitted: releaseMarker,
});
const panelUrl = chrome.runtime.getURL("sidepanel.html");
const resolveSidePanelContext = createSidePanelContextResolver({
  runtime: chrome.runtime,
  tabs: chrome.tabs,
  panelUrl,
});
const standaloneWindowManager = createStandaloneWindowManager({
  panelUrl,
  runtime: chrome.runtime,
  tabs: chrome.tabs,
  windows: chrome.windows,
});
const handleActiveTabActivation = createActiveTabActivationHandler({
  runtime: chrome.runtime,
  tabs: chrome.tabs,
  configureSidePanelForTab,
  onError: logSidePanelConfigurationError,
});
const readCurrentPageContext = createCurrentPageContextReader({
  targetTab: ({ sender, tabId }) => targetTab(sender, tabId),
  sendPageContextRequest: (tabId) => sendToTab(tabId, { type: "GET_PAGE_CONTEXT" }),
});
const configureExistingSidePanelOptions = createExistingSidePanelOptionsConfigurator({
  tabs: chrome.tabs,
  sidePanel: chrome.sidePanel,
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

function notifyActiveContextChanged(tabId, windowId) {
  const message = activeContextChangedMessage(tabId, windowId);
  if (!message) return;
  void chrome.runtime.sendMessage(message).catch(() => {});
}

void chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn("配置工具栏侧栏入口失败", error));
void configureExistingSidePanelOptions();

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    try {
      await clearLegacyCloudTranslationSettings(chrome.storage.local);
    } catch (error) {
      console.warn("初始化扩展设置失败", error);
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
  } else if (changeInfo.status === "complete") {
    void chrome.runtime.sendMessage({ type: "BOUND_TAB_CHANGED", tabId }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void handleActiveTabActivation(activeInfo);
});

async function activeSupportedTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("没有找到当前标签页");
  return tab;
}

function isPanelSender(sender) {
  try {
    const senderUrl = new URL(sender?.url);
    const expected = new URL(panelUrl);
    return senderUrl.protocol === expected.protocol
      && senderUrl.host === expected.host
      && senderUrl.pathname === expected.pathname;
  } catch {
    return false;
  }
}

async function targetTab(sender, requestedTabId, {
  activateStandalone = false,
  requireActiveSidePanel = false,
} = {}) {
  if (isPanelSender(sender)) {
    return sidePanelTargetTab(sender, requestedTabId, {
      activateStandalone,
      requireActiveSidePanel,
    });
  }
  if (sender.tab?.id) return sender.tab;
  if (Number.isInteger(requestedTabId)) return chrome.tabs.get(requestedTabId);
  return activeSupportedTab();
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
      reasons: ["BLOBS"],
      justification: "生成可下载的笔记与字幕 ZIP 文件",
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

async function beginMarker(
  tab,
  { localTranscriptNoteSource } = {},
) {
  const markerId = crypto.randomUUID();
  const snapshot = await sendToTab(tab.id, {
    type: "PREPARE_MARKER",
    markerId,
    localTranscriptNoteSource,
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
    inputType: "typed",
    body: "",
    subtitleContext: snapshot.subtitleContext,
    screenshotKey: "",
    warnings: [],
    wasPlaying: snapshot.wasPlaying,
    userEditVersion: 0,
    status: "draft",
    subtitleTranslation: String(snapshot.subtitleTranslation ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  };

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
  return { session, note };
}

async function releaseMarker(note) {
  try {
    const response = await sendToTab(note.tabId, {
      type: "RELEASE_MARKER",
      markerId: note.id,
      allowResume: true,
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
  await releaseMarker(note);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.runtime.sendMessage({ type: "BOUND_TAB_REMOVED", tabId }).catch(() => {});
});

async function currentPageContext({ sender, tabId }) {
  return readCurrentPageContext({ sender, tabId });
}

const NOTE_MUTATION_COMMANDS = new Set([
  "COMMIT_TYPED_NOTE",
  "UPDATE_NOTE_BODY",
  "UPDATE_NOTE_SUBTITLE",
  "DELETE_NOTE",
  "CLEAR_SESSION_NOTES",
  "UNDO_NOTE_ACTION",
  "REDO_NOTE_ACTION",
]);
const NOTE_ID_MUTATION_COMMANDS = new Set([
  "COMMIT_TYPED_NOTE",
  "UPDATE_NOTE_BODY",
  "UPDATE_NOTE_SUBTITLE",
  "DELETE_NOTE",
]);

async function noteHistoryRequest(message, sender) {
  if (!isPanelSender(sender)) {
    return { sender, tabId: message.tabId };
  }

  const { context, contexts, fallbackTab } = await resolveSidePanelContext(sender);
  let tabId;
  if (context.mode === "standalone") {
    const tab = await sidePanelTargetTab(sender, message.tabId, {
      requireActiveSidePanel: false,
    });
    tabId = tab.id;
  } else {
    const boundTabId = sidePanelTabIdForSender(sender, contexts);
    const [activeTab] = fallbackTab
      ? [fallbackTab]
      : boundTabId === message.tabId
        ? []
        : await chrome.tabs.query({ active: true, windowId: context.windowId });
    tabId = sidePanelRequestTabIdForSender(
      sender,
      contexts,
      activeTab,
      message.tabId,
    );
  }
  if (NOTE_ID_MUTATION_COMMANDS.has(message.type)) {
    const note = await repository.getNote(message.noteId);
    if (message.type === "COMMIT_TYPED_NOTE") {
      if (Number.isInteger(note?.tabId) && note.tabId !== tabId) {
        throw new Error("标记不属于当前标签页");
      }
    } else {
      // 已保存笔记按视频共享，创建时的标签页可能已经关闭或被浏览器重新编号。
      const pageContext = await currentPageContext({ sender, tabId });
      if (!note || !pageContext || note.sessionId !== pageContext.sessionId) {
        throw new Error("标记不属于当前页面会话");
      }
    }
  }
  return { sender, tabId };
}

async function sidePanelTargetTab(sender, requestedTabId, {
  activateStandalone = false,
  requireActiveSidePanel = true,
} = {}) {
  const { context, contexts, fallbackTab } = await resolveSidePanelContext(sender);
  if (context.mode === "standalone") {
    standalonePanelRequestTabId(context, requestedTabId);
    let target;
    try {
      target = fallbackTab ?? await chrome.tabs.get(context.tabId);
    } catch {
      throw new Error("原视频标签页已关闭");
    }
    return activateStandalone
      ? activateStandaloneTargetTab(chrome.tabs, context, target)
      : target;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, windowId: context.windowId });
  if (requireActiveSidePanel) {
    activeSidePanelRequestTabId(context, activeTab, requestedTabId);
    return activeTab;
  }
  const targetTabId = sidePanelRequestTabIdForSender(
    sender,
    contexts,
    activeTab,
    requestedTabId,
  );
  if (fallbackTab?.id === targetTabId) return fallbackTab;
  if (activeTab?.id === targetTabId) return activeTab;
  return chrome.tabs.get(targetTabId);
}

const pendingTranscriptReads = new Map();

async function readFullYoutubeTranscript(tab) {
  const key = `${tab.id}:${tab.url}`;
  if (!pendingTranscriptReads.has(key)) {
    const read = readFullYoutubeTranscriptOnce(tab).finally(() => {
      if (pendingTranscriptReads.get(key) === read) pendingTranscriptReads.delete(key);
    });
    pendingTranscriptReads.set(key, read);
  }
  return pendingTranscriptReads.get(key);
}

async function readFullYoutubeTranscriptOnce(tab) {
  const response = await sendToTab(tab.id, { type: "GET_FULL_YOUTUBE_TRANSCRIPT" });
  if (!shouldAttemptYoutubePlayerCapture(response.transcript)) {
    return { transcript: response.transcript };
  }
  let capture;
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: captureYoutubePlayerTranscript,
      args: [8000, { videoId: response.transcript.videoId }],
    });
    capture = injection[0]?.result;
  } catch {
    capture = { ok: false, code: "YOUTUBE_PLAYER_CAPTURE_FAILED" };
  }
  return {
    transcript: transcriptResultAfterPlayerCapture(response.transcript, capture),
  };
}

async function handleMessage(message, sender) {
  if (isNoteHistoryCommand(message.type)) {
    const request = await noteHistoryRequest(message, sender);
    const result = await noteHistoryCommandRouter(message, request);
    if (NOTE_MUTATION_COMMANDS.has(message.type) && Number.isInteger(request.tabId)) {
      void chrome.runtime.sendMessage({
        type: "NOTES_CHANGED",
        tabId: request.tabId,
      }).catch(() => {});
    }
    return result;
  }
  switch (message.type) {
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
      const { context } = await resolveSidePanelContext(sender);
      return context;
    }
    case "OPEN_STANDALONE_WINDOW": {
      const tab = await sidePanelTargetTab(sender, message.tabId, {
        requireActiveSidePanel: false,
      });
      return standaloneWindowManager.open(tab);
    }
    case "FOCUS_BOUND_VIDEO": {
      const tab = await sidePanelTargetTab(sender, message.tabId, {
        requireActiveSidePanel: false,
      });
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return {};
    }
    case "GET_FULL_YOUTUBE_TRANSCRIPT": {
      const tab = await targetTab(sender, message.tabId);
      return readFullYoutubeTranscript(tab);
    }
    case "GET_VIDEO_POSITION": {
      const tab = await targetTab(sender, message.tabId);
      const response = await sendToTab(tab.id, {
        type: "GET_VIDEO_POSITION",
        sessionId: message.sessionId,
        videoId: message.videoId,
      });
      return { seconds: response.seconds };
    }
    case "CONTROL_VIDEO_PLAYBACK": {
      const tab = await sidePanelTargetTab(sender, message.tabId);
      const response = await sendToTab(tab.id, {
        type: "CONTROL_VIDEO_PLAYBACK",
        command: message.command,
        sessionId: message.sessionId,
        videoId: message.videoId,
      });
      return {
        seconds: response.seconds,
        paused: response.paused,
      };
    }
    case "SYNC_LOCAL_TRANSCRIPT_NOTE_SOURCE": {
      const tab = await targetTab(sender, message.tabId);
      const response = await sendToTab(tab.id, {
        type: "SYNC_LOCAL_TRANSCRIPT_NOTE_SOURCE",
        revision: message.revision,
        sessionId: message.sessionId,
        videoId: message.videoId,
        source: message.source,
      });
      return { synced: response.synced === true };
    }
    case "SEEK_VIDEO": {
      const tab = await targetTab(sender, message.tabId);
      const response = await sendToTab(tab.id, {
        type: "SEEK_VIDEO",
        seconds: message.seconds,
        sessionId: message.sessionId,
        videoId: message.videoId,
      });
      return { seconds: response.seconds };
    }
    case "BEGIN_TYPED_NOTE": {
      const tab = await targetTab(sender, message.tabId, {
        activateStandalone: true,
        requireActiveSidePanel: true,
      });
      return beginMarker(tab, {
        localTranscriptNoteSource: message.localTranscriptNoteSource,
      });
    }
    case "CANCEL_NOTE": {
      if (isPanelSender(sender)) {
        const tab = await sidePanelTargetTab(sender, message.tabId, {
          requireActiveSidePanel: false,
        });
        const note = await repository.getNote(message.noteId);
        if (Number.isInteger(note?.tabId) && note.tabId !== tab.id) {
          throw new Error("标记不属于当前标签页");
        }
      }
      await cancelNote(message.noteId);
      return {};
    }
    case "EXPORT_SESSION": {
      const tab = await sidePanelTargetTab(sender, message.tabId, { requireActiveSidePanel: false });
      const context = await currentPageContext({ sender, tabId: tab.id });
      if (!context || context.sessionId !== message.sessionId) throw new Error("当前页面会话不匹配");
      const session = await repository.getSession(context.sessionId) ?? { ...context, id: context.sessionId };
      // The in-memory track survives a failed cache write, but must belong to this video.
      let transcript = cachedFullTranscriptForContext({
        schemaVersion: 1, id: session.id, videoId: session.videoId, transcript: message.transcript,
      }, { sessionId: session.id, videoId: session.videoId });
      if (!transcript && context.platform === "youtube") {
        const loader = createFullTranscriptCacheLoader({
          repository,
          fetchTranscript: async () => (await readFullYoutubeTranscript(tab)).transcript,
        });
        try {
          transcript = (await loader.load({ sessionId: session.id, videoId: session.videoId })).transcript;
        } catch {
          // Failed subtitle access must not prevent export of the user's notes.
        }
      }
      return sendToOffscreen({ type: "EXPORT_SESSION", session, transcript, language: message.language });
    }
    case "CONTEXT_CHANGED": {
      const tab = contextChangedSenderTab(sender);
      if (!tab) {
        console.warn("视频上下文变化缺少有效发送标签页");
        return {};
      }
      await configureSidePanelForTab(tab);
      notifyActiveContextChanged(tab.id, tab.windowId);
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
