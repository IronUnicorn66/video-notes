import {
  acquirePlaybackLease,
  markPlayerPointerIntervention,
  markPlaybackIntervention,
  releasePlaybackLease,
} from "./core/playback-lease.js";
import { PushToTalkController, isEditableTarget } from "./core/push-to-talk.js";
import { buildJumpUrl, parseVideoContext } from "./core/site-adapter.js";
import { SubtitleCapture } from "./core/subtitle-capture.js";
import { readRenderedSubtitleText } from "./core/subtitle-text.js";
import { readYoutubeFullTranscript } from "./core/youtube-full-transcript.js";
import { localizeRuntimeMessage, resolveLanguage, translate } from "./core/i18n.js";

const subtitleCapture = new SubtitleCapture({ subtitleEnabled: false });
let currentMedia = null;
let activeLease = null;
let activeLeaseTimer = null;
let expectedPlaybackEvent = null;
let currentUrl = location.href;
let recordingOverlay = null;
let shortcutError = null;
let shortcutErrorTimer = null;
let shortcutCode = "AltRight";
let interfaceLanguage = resolveLanguage(undefined, chrome.i18n.getUILanguage());
const t = (key, variables) => translate(interfaceLanguage, key, variables);

function videoTitle(platform) {
  if (platform === "youtube") {
    return (
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim() ||
      document.title.replace(/\s+-\s+YouTube$/, "")
    );
  }
  return (
    document.querySelector("h1.video-title")?.getAttribute("title") ||
    document.querySelector("h1.video-title")?.textContent?.trim() ||
    document.title.replace(/_哔哩哔哩_bilibili$/, "")
  );
}

function getContext() {
  const preliminary = parseVideoContext(location.href);
  if (!preliminary) return null;
  return parseVideoContext(location.href, videoTitle(preliminary.platform));
}

function visibleArea(element) {
  const rect = element.getBoundingClientRect();
  return Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) *
    Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
}

function findMedia() {
  const candidates = [...document.querySelectorAll("video")];
  return candidates.sort((left, right) => visibleArea(right) - visibleArea(left))[0] ?? null;
}

function findPlayerElement(context, media) {
  if (context.platform === "youtube") {
    return document.querySelector("#movie_player") ?? media;
  }
  return (
    document.querySelector(".bpx-player-container") ??
    document.querySelector(".bilibili-player-video-wrap") ??
    media
  );
}

function consumeExpectedEvent(type) {
  if (
    expectedPlaybackEvent?.type === type &&
    performance.now() <= expectedPlaybackEvent.expiresAt
  ) {
    expectedPlaybackEvent = null;
    return true;
  }
  expectedPlaybackEvent = null;
  return false;
}

function onMediaStateChange(event) {
  if (!activeLease || consumeExpectedEvent(event.type)) return;
  activeLease = markPlaybackIntervention(activeLease, event.type);
}

function onPlayerPointerDown(event) {
  if (!activeLease) return;
  const context = getContext();
  const media = bindMedia();
  if (!context || !media) return;
  activeLease = markPlayerPointerIntervention(
    activeLease,
    findPlayerElement(context, media),
    event.target,
  );
}

function bindMedia() {
  const next = findMedia();
  if (next === currentMedia) return next;
  currentMedia?.removeEventListener("play", onMediaStateChange);
  currentMedia?.removeEventListener("pause", onMediaStateChange);
  currentMedia = next;
  currentMedia?.addEventListener("play", onMediaStateChange);
  currentMedia?.addEventListener("pause", onMediaStateChange);
  return next;
}

function activateMarker(markerId, wasPlaying) {
  if (activeLease) throw new Error("当前已有标记正在编辑");
  const media = bindMedia();
  if (!media) throw new Error("没有找到可用的视频播放器");
  const lease = acquirePlaybackLease(media, { wasPlaying });
  activeLease = { ...lease, markerId };
  activeLeaseTimer = setTimeout(() => void releaseMarker(markerId), 90_000);
  if (lease.shouldPause) {
    expectedPlaybackEvent = { type: "pause", expiresAt: performance.now() + 1500 };
    media.pause();
  }
  return lease.wasPlaying;
}

function markerResumeEligibility(markerId) {
  if (!activeLease || activeLease.markerId !== markerId) return false;
  const media = bindMedia();
  return releasePlaybackLease(activeLease, media ?? { paused: true }).shouldPlay;
}

async function releaseMarker(markerId, { allowResume = true } = {}) {
  if (!activeLease || activeLease.markerId !== markerId) return false;
  clearTimeout(activeLeaseTimer);
  activeLeaseTimer = null;
  const media = bindMedia();
  const result = releasePlaybackLease(activeLease, media ?? { paused: true });
  activeLease = null;
  if (allowResume && result.shouldPlay && media) {
    expectedPlaybackEvent = { type: "play", expiresAt: performance.now() + 1500 };
    try {
      await media.play();
    } catch {
      return false;
    }
  }
  return allowResume && result.shouldPlay;
}

function collectSubtitles() {
  const context = getContext();
  const media = bindMedia();
  if (!context || !media) return;
  subtitleCapture.add(
    media.currentTime,
    readRenderedSubtitleText(document, context.platform),
  );
}

function markerSnapshot(markerId, { deferPause = false } = {}) {
  const context = getContext();
  const media = bindMedia();
  if (!context || !media) throw new Error("当前标签页没有受支持的视频");
  const seconds = Math.max(0, media.currentTime || 0);
  const rect = findPlayerElement(context, media).getBoundingClientRect();
  const snapshot = {
    context,
    seconds,
    jumpUrl: buildJumpUrl(context, seconds),
    subtitleContext: subtitleCapture.before(seconds),
    rect: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    viewport: { width: innerWidth, height: innerHeight },
  };
  snapshot.wasPlaying = !media.paused;
  if (!deferPause) activateMarker(markerId, snapshot.wasPlaying);
  return snapshot;
}

function showRecordingOverlay() {
  if (!document.fullscreenElement || recordingOverlay) return;
  recordingOverlay = document.createElement("div");
  recordingOverlay.textContent = t("contentRecording");
  Object.assign(recordingOverlay.style, {
    position: "fixed",
    top: "18px",
    left: "50%",
    zIndex: "2147483647",
    transform: "translateX(-50%)",
    padding: "7px 12px",
    borderRadius: "999px",
    color: "#fff",
    background: "rgba(157, 39, 32, .88)",
    font: "600 13px -apple-system, BlinkMacSystemFont, sans-serif",
    pointerEvents: "none",
  });
  (document.fullscreenElement ?? document.documentElement).append(recordingOverlay);
}

function hideRecordingOverlay() {
  recordingOverlay?.remove();
  recordingOverlay = null;
}

function hideShortcutError() {
  clearTimeout(shortcutErrorTimer);
  shortcutError?.remove();
  shortcutError = null;
}

function showShortcutError(message) {
  hideShortcutError();
  shortcutError = document.createElement("div");
  shortcutError.setAttribute("role", "status");
  shortcutError.textContent = t("contentErrorPrefix", {
    message: localizeRuntimeMessage(interfaceLanguage, message),
  });
  Object.assign(shortcutError.style, {
    position: "fixed",
    right: "18px",
    bottom: "18px",
    zIndex: "2147483647",
    maxWidth: "360px",
    padding: "10px 13px",
    borderRadius: "10px",
    color: "#fff",
    background: "rgba(36, 42, 39, .94)",
    boxShadow: "0 8px 28px rgba(0, 0, 0, .24)",
    font: "500 13px/1.45 -apple-system, BlinkMacSystemFont, sans-serif",
    pointerEvents: "none",
  });
  (document.fullscreenElement ?? document.documentElement).append(shortcutError);
  shortcutErrorTimer = setTimeout(hideShortcutError, 4200);
}

const pushToTalk = new PushToTalkController({
  keyCode: shortcutCode,
  onStart: async () => {
    hideShortcutError();
    const response = await chrome.runtime.sendMessage({ type: "VOICE_START_REQUEST" });
    if (!response?.ok) throw new Error(response?.error ?? t("recordingStartFailed"));
    if (response.canceled) throw new Error(t("recordingCanceled"));
    showRecordingOverlay();
  },
  onStop: async (reason) => {
    hideRecordingOverlay();
    const response = await chrome.runtime.sendMessage({ type: "VOICE_STOP_REQUEST", reason });
    if (!response?.ok) console.warn("视频笔记停止录音失败", response?.error);
  },
});

function matchesShortcut(event) {
  return event.code === shortcutCode && !isEditableTarget(event.target);
}

window.addEventListener("keydown", (event) => {
  if (!matchesShortcut(event) || event.repeat) return;
  event.preventDefault();
  void pushToTalk.keyDown(event).catch((error) => {
    hideRecordingOverlay();
    showShortcutError(error.message);
    console.warn("视频笔记录音启动失败", error);
  });
}, true);

window.addEventListener("keyup", (event) => {
  if (event.code !== shortcutCode) return;
  event.preventDefault();
  void pushToTalk.keyUp(event);
}, true);

window.addEventListener("blur", () => void pushToTalk.forceStop("window-blur"));
window.addEventListener("pagehide", () => void pushToTalk.forceStop("pagehide"));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void pushToTalk.forceStop("tab-hidden");
});
document.addEventListener("pointerdown", onPlayerPointerDown, true);

chrome.storage.local.get({
  interfaceLanguage: undefined,
  shortcutCode: "AltRight",
  subtitleEnabled: true,
  subtitleWindowSeconds: 20,
}).then(({
  shortcutCode: saved,
  interfaceLanguage: savedLanguage,
  subtitleEnabled,
  subtitleWindowSeconds,
}) => {
  interfaceLanguage = resolveLanguage(savedLanguage, chrome.i18n.getUILanguage());
  shortcutCode = saved;
  pushToTalk.keyCode = saved;
  subtitleCapture.updateSettings({ subtitleEnabled, subtitleWindowSeconds });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.interfaceLanguage) {
    interfaceLanguage = resolveLanguage(
      changes.interfaceLanguage.newValue,
      chrome.i18n.getUILanguage(),
    );
  }
  if (changes.shortcutCode?.newValue) {
    shortcutCode = changes.shortcutCode.newValue;
    pushToTalk.keyCode = shortcutCode;
  }
  const subtitleSettings = {};
  if (changes.subtitleEnabled) {
    subtitleSettings.subtitleEnabled = changes.subtitleEnabled.newValue;
  }
  if (changes.subtitleWindowSeconds) {
    subtitleSettings.subtitleWindowSeconds = changes.subtitleWindowSeconds.newValue;
  }
  if (Object.keys(subtitleSettings).length > 0) {
    subtitleCapture.updateSettings(subtitleSettings);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (![
    "GET_PAGE_CONTEXT",
    "GET_FULL_YOUTUBE_TRANSCRIPT",
    "PREPARE_MARKER",
    "ACTIVATE_MARKER",
    "GET_MARKER_RESUME_ELIGIBILITY",
    "RELEASE_MARKER",
    "FORCE_STOP_RECORDING",
  ].includes(message.type)) {
    return false;
  }
  const handle = async () => {
    switch (message.type) {
      case "GET_PAGE_CONTEXT":
        return { context: getContext() };
      case "GET_FULL_YOUTUBE_TRANSCRIPT": {
        const context = getContext();
        if (context?.platform !== "youtube") {
          return {
            transcript: {
              ok: false,
              code: "PLATFORM_UNSUPPORTED",
              trackCount: 0,
            },
          };
        }
        return {
          transcript: await readYoutubeFullTranscript(document, {
            preferredLanguages: navigator.languages ?? [navigator.language],
          }),
        };
      }
      case "PREPARE_MARKER":
        return markerSnapshot(message.markerId, { deferPause: message.deferPause === true });
      case "ACTIVATE_MARKER":
        return { wasPlaying: activateMarker(message.markerId, message.wasPlaying === true) };
      case "GET_MARKER_RESUME_ELIGIBILITY":
        return { shouldResume: markerResumeEligibility(message.markerId) };
      case "RELEASE_MARKER":
        return {
          resumed: await releaseMarker(message.markerId, {
            allowResume: message.allowResume !== false,
          }),
        };
      case "FORCE_STOP_RECORDING":
        hideRecordingOverlay();
        return { stopped: pushToTalk.reset() };
      default:
        return {};
    }
  };
  void handle().then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});

setInterval(() => {
  collectSubtitles();
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    if (activeLease) void releaseMarker(activeLease.markerId);
    subtitleCapture.clear();
    chrome.runtime.sendMessage({ type: "CONTEXT_CHANGED", context: getContext() });
  }
}, 400);

collectSubtitles();
