import { acquirePlaybackLease, markPlaybackIntervention, releasePlaybackLease } from "./core/playback-lease.js";
import { PushToTalkController, isEditableTarget } from "./core/push-to-talk.js";
import { buildJumpUrl, parseVideoContext } from "./core/site-adapter.js";
import { SubtitleBuffer } from "./core/subtitle-buffer.js";

const subtitleBuffer = new SubtitleBuffer({ retentionSeconds: 60 });
let currentMedia = null;
let activeLease = null;
let activeLeaseTimer = null;
let expectedPlaybackEvent = null;
let currentUrl = location.href;
let recordingOverlay = null;
let shortcutCode = "AltRight";

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

function renderedSubtitleText(context) {
  const selector = context.platform === "youtube"
    ? ".ytp-caption-segment"
    : ".bpx-player-subtitle-panel-text, .bilibili-player-video-subtitle";
  return [...document.querySelectorAll(selector)]
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => element.textContent?.trim())
    .filter(Boolean)
    .join(" ");
}

function collectSubtitles() {
  const context = getContext();
  const media = bindMedia();
  if (!context || !media) return;
  subtitleBuffer.add(media.currentTime, renderedSubtitleText(context));
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
    subtitleContext: subtitleBuffer.before(seconds, { seconds: 20, maxChars: 500 }),
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
  recordingOverlay.textContent = "● 录音中";
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
  document.documentElement.append(recordingOverlay);
}

function hideRecordingOverlay() {
  recordingOverlay?.remove();
  recordingOverlay = null;
}

const pushToTalk = new PushToTalkController({
  keyCode: shortcutCode,
  onStart: async () => {
    const response = await chrome.runtime.sendMessage({ type: "VOICE_START_REQUEST" });
    if (!response?.ok) throw new Error(response?.error ?? "录音启动失败");
    if (response.canceled) throw new Error("录音已取消");
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

chrome.storage.local.get({ shortcutCode: "AltRight" }).then(({ shortcutCode: saved }) => {
  shortcutCode = saved;
  pushToTalk.keyCode = saved;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.shortcutCode?.newValue) {
    shortcutCode = changes.shortcutCode.newValue;
    pushToTalk.keyCode = shortcutCode;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (![
    "GET_PAGE_CONTEXT",
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
    subtitleBuffer.items = [];
    chrome.runtime.sendMessage({ type: "CONTEXT_CHANGED", context: getContext() });
  }
}, 400);

collectSubtitles();
