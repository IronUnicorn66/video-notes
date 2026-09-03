export const PLAYBACK_COMMAND = Object.freeze({
  TOGGLE_PLAYBACK: "toggle-playback",
  SEEK_BACKWARD: "seek-backward",
  SEEK_FORWARD: "seek-forward",
});

export const VIDEO_PLAYBACK_SEEK_SECONDS = 5;

const COMMAND_BY_CODE = new Map([
  ["Space", PLAYBACK_COMMAND.TOGGLE_PLAYBACK],
  ["ArrowLeft", PLAYBACK_COMMAND.SEEK_BACKWARD],
  ["ArrowRight", PLAYBACK_COMMAND.SEEK_FORWARD],
]);
const RESERVED_VIDEO_PLAYBACK_CODES = new Set(COMMAND_BY_CODE.keys());
const TEXT_INPUT_TYPES = new Set([
  "",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);
const SUPPORTED_PLATFORMS = new Set(["youtube", "bilibili"]);

function isTextEditingTarget(target) {
  if (!target) return false;
  const tagName = String(target.tagName ?? "").toUpperCase();
  if (tagName === "TEXTAREA") return true;
  if (tagName === "INPUT") {
    return TEXT_INPUT_TYPES.has(String(target.type ?? "").toLowerCase());
  }
  return (
    target.isContentEditable === true
    || target.getAttribute?.("role") === "textbox"
    || Boolean(target.closest?.('[role="textbox"]'))
  );
}

export function playbackCommandForKeyEvent(event) {
  if (
    event.defaultPrevented
    || event.isComposing
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || isTextEditingTarget(event.target)
  ) {
    return null;
  }
  return COMMAND_BY_CODE.get(event.code) ?? null;
}

export function shouldExecutePlaybackCommand(event, command) {
  return command !== PLAYBACK_COMMAND.TOGGLE_PLAYBACK || event.repeat !== true;
}

export function isReservedVideoPlaybackCode(code) {
  return RESERVED_VIDEO_PLAYBACK_CODES.has(code);
}

export function normalizePushToTalkShortcut(code) {
  return !code || isReservedVideoPlaybackCode(code) ? "AltRight" : code;
}

function visibleArea(element, { width, height }) {
  const rect = element.getBoundingClientRect();
  return Math.max(0, Math.min(width, rect.right) - Math.max(0, rect.left))
    * Math.max(0, Math.min(height, rect.bottom) - Math.max(0, rect.top));
}

export function findPrimaryVideo(root, viewport) {
  const videos = [...root.querySelectorAll("video")];
  return videos.sort(
    (left, right) => visibleArea(right, viewport) - visibleArea(left, viewport),
  )[0] ?? null;
}

function assertPlaybackContext({
  media,
  context,
  expectedSessionId,
  expectedVideoId,
}) {
  if (!media) throw new Error("没有找到可用的视频播放器");
  if (!SUPPORTED_PLATFORMS.has(context?.platform)) {
    throw new Error("当前页面没有受支持的视频");
  }
  const isScopedCommand = expectedSessionId !== undefined || expectedVideoId !== undefined;
  if (
    isScopedCommand
    && (
      context.sessionId !== expectedSessionId
      || context.videoId !== expectedVideoId
    )
  ) {
    throw new Error("当前页面会话不匹配");
  }
}

function readMediaTime(media) {
  const seconds = Number(media.currentTime);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("无效的视频时间点");
  return seconds;
}

function seekMedia(media, offset) {
  const current = readMediaTime(media);
  const duration = Number(media.duration);
  const upperBound = Number.isFinite(duration) && duration >= 0 ? duration : Infinity;
  media.currentTime = Math.min(upperBound, Math.max(0, current + offset));
}

export async function controlVideoPlayback({
  media,
  context,
  command,
  expectedSessionId,
  expectedVideoId,
}) {
  assertPlaybackContext({
    media,
    context,
    expectedSessionId,
    expectedVideoId,
  });

  switch (command) {
    case PLAYBACK_COMMAND.TOGGLE_PLAYBACK:
      if (media.paused) await media.play();
      else media.pause();
      break;
    case PLAYBACK_COMMAND.SEEK_BACKWARD:
      seekMedia(media, -VIDEO_PLAYBACK_SEEK_SECONDS);
      break;
    case PLAYBACK_COMMAND.SEEK_FORWARD:
      seekMedia(media, VIDEO_PLAYBACK_SEEK_SECONDS);
      break;
    default:
      throw new Error("未知的播放器命令");
  }

  return {
    seconds: readMediaTime(media),
    paused: Boolean(media.paused),
  };
}
