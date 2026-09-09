import {
  acquirePlaybackLease,
  markPlayerPointerIntervention,
  markPlaybackIntervention,
  releasePlaybackLease,
} from "./core/playback-lease.js";
import { buildJumpUrl, parseVideoContext } from "./core/site-adapter.js";
import { SubtitleCapture } from "./core/subtitle-capture.js";
import { readRenderedSubtitleText } from "./core/subtitle-text.js";
import { BilibiliTranscriptSource } from "./core/bilibili-transcript.js";
import { readYoutubeFullTranscript } from "./core/youtube-full-transcript.js";
import {
  localTranscriptNoteContext,
  preferredNoteSubtitleContext,
} from "./core/local-transcript-note-context.js";
import {
  readMediaTimeForVideoContext,
  seekMediaForVideoContext,
} from "./core/video-command-context.js";
import {
  controlVideoPlayback,
  findPrimaryVideo,
} from "./core/video-playback-shortcuts.js";
import { installVideoPageShortcuts } from "./core/video-page-shortcuts.js";

const subtitleCapture = new SubtitleCapture({ subtitleEnabled: false });
const bilibiliTranscriptSource = new BilibiliTranscriptSource();
let currentMedia = null;
let activeLease = null;
let activeLeaseTimer = null;
let expectedPlaybackEvent = null;
let currentUrl = location.href;
let localTranscriptNoteSource = null;
let localTranscriptNoteSourceRevision = 0;

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

function findMedia() {
  return findPrimaryVideo(document, { width: innerWidth, height: innerHeight });
}

installVideoPageShortcuts({
  eventTarget: window,
  root: document,
  getContext,
  getViewport: () => ({ width: innerWidth, height: innerHeight }),
  onError: (error) => console.warn("视频笔记播放器快捷键执行失败", error),
});

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

function preferredSubtitleLanguages() {
  return navigator.languages ?? [navigator.language];
}

async function loadBilibiliTranscriptNoteSource(context = getContext()) {
  if (!subtitleCapture.enabled || context?.platform !== "bilibili") return null;
  return bilibiliTranscriptSource.load(context, {
    preferredLanguages: preferredSubtitleLanguages(),
  });
}

function markerSnapshot(
  markerId,
  { deferPause = false, localTranscriptNoteSource: preferredSource } = {},
) {
  const context = getContext();
  const media = bindMedia();
  if (!context || !media) throw new Error("当前标签页没有受支持的视频");
  const seconds = Math.max(0, media.currentTime || 0);
  const wasPlaying = !media.paused;
  const rect = findPlayerElement(context, media).getBoundingClientRect();
  const bilibiliSource = bilibiliTranscriptSource.get(context);
  const localSubtitles = localTranscriptNoteContext({
    context,
    source: context.platform === "bilibili" ? bilibiliSource : localTranscriptNoteSource,
    preferredSource: context.platform === "youtube" ? preferredSource : null,
    markerSeconds: seconds,
    windowSeconds: subtitleCapture.windowSeconds,
    enabled: subtitleCapture.enabled,
  });
  const subtitles = preferredNoteSubtitleContext({
    platform: context.platform,
    renderedText: subtitleCapture.before(seconds),
    localSubtitles,
  });
  const snapshot = {
    context,
    seconds,
    jumpUrl: buildJumpUrl(context, seconds),
    subtitleContext: subtitles.subtitleContext,
    subtitleTranslation: subtitles.subtitleTranslation,
    rect: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    viewport: { width: innerWidth, height: innerHeight },
  };
  snapshot.wasPlaying = wasPlaying;
  if (!deferPause) activateMarker(markerId, snapshot.wasPlaying);
  return snapshot;
}

function syncLocalTranscriptNoteSource(message) {
  const context = getContext();
  const revision = Number(message.revision);
  if (
    !context
    || context.platform !== "youtube"
    || context.sessionId !== message.sessionId
    || context.videoId !== message.videoId
    || !Number.isSafeInteger(revision)
    || revision < localTranscriptNoteSourceRevision
  ) return false;

  localTranscriptNoteSourceRevision = revision;
  if (!message.source) {
    localTranscriptNoteSource = null;
    return true;
  }
  if (
    message.source.sessionId !== context.sessionId
    || message.source.videoId !== context.videoId
    || !Array.isArray(message.source.groups)
  ) return false;
  localTranscriptNoteSource = message.source;
  return true;
}

document.addEventListener("pointerdown", onPlayerPointerDown, true);

chrome.storage.local.get({
  subtitleEnabled: true,
  subtitleWindowSeconds: 20,
}).then(({
  subtitleEnabled,
  subtitleWindowSeconds,
}) => {
  subtitleCapture.updateSettings({ subtitleEnabled, subtitleWindowSeconds });
  if (subtitleEnabled) void loadBilibiliTranscriptNoteSource();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
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
  if (changes.subtitleEnabled) {
    if (changes.subtitleEnabled.newValue) void loadBilibiliTranscriptNoteSource();
    else bilibiliTranscriptSource.clear();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (![
    "GET_PAGE_CONTEXT",
    "GET_FULL_YOUTUBE_TRANSCRIPT",
    "GET_VIDEO_POSITION",
    "CONTROL_VIDEO_PLAYBACK",
    "SYNC_LOCAL_TRANSCRIPT_NOTE_SOURCE",
    "SEEK_VIDEO",
    "PREPARE_MARKER",
    "ACTIVATE_MARKER",
    "GET_MARKER_RESUME_ELIGIBILITY",
    "RELEASE_MARKER",
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
            videoId: context.videoId,
          }),
        };
      }
      case "GET_VIDEO_POSITION": {
        const seconds = readMediaTimeForVideoContext({
          media: findMedia(),
          context: getContext(),
          expectedSessionId: message.sessionId,
          expectedVideoId: message.videoId,
        });
        return { seconds };
      }
      case "CONTROL_VIDEO_PLAYBACK":
        return controlVideoPlayback({
          media: bindMedia(),
          context: getContext(),
          command: message.command,
          expectedSessionId: message.sessionId,
          expectedVideoId: message.videoId,
        });
      case "SYNC_LOCAL_TRANSCRIPT_NOTE_SOURCE":
        return { synced: syncLocalTranscriptNoteSource(message) };
      case "SEEK_VIDEO": {
        const seconds = seekMediaForVideoContext({
          media: findMedia(),
          context: getContext(),
          seconds: message.seconds,
          expectedSessionId: message.sessionId,
          expectedVideoId: message.videoId,
        });
        return { seconds };
      }
      case "PREPARE_MARKER":
        return markerSnapshot(message.markerId, {
          deferPause: message.deferPause === true,
          localTranscriptNoteSource: message.localTranscriptNoteSource,
        });
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
    bilibiliTranscriptSource.clear();
    localTranscriptNoteSource = null;
    localTranscriptNoteSourceRevision = 0;
    const context = getContext();
    void loadBilibiliTranscriptNoteSource(context);
    chrome.runtime.sendMessage({ type: "CONTEXT_CHANGED", context });
  }
}, 400);

collectSubtitles();
