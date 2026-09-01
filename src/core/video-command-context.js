function assertCurrentVideoContext({
  media,
  context,
  expectedSessionId,
  expectedVideoId,
}) {
  if (!media) throw new Error("没有找到可用的视频播放器");
  if (
    !context
    || !expectedSessionId
    || !expectedVideoId
    || context.sessionId !== expectedSessionId
    || context.videoId !== expectedVideoId
  ) {
    throw new Error("当前页面会话不匹配");
  }
}

export function readMediaTimeForVideoContext(options) {
  assertCurrentVideoContext(options);
  const seconds = Number(options.media.currentTime);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("无效的视频时间点");
  return seconds;
}

export function seekMediaForVideoContext({
  media,
  context,
  seconds,
  expectedSessionId,
  expectedVideoId,
}) {
  assertCurrentVideoContext({
    media,
    context,
    expectedSessionId,
    expectedVideoId,
  });
  const target = Number(seconds);
  if (!Number.isFinite(target) || target < 0) throw new Error("无效的视频时间点");
  media.currentTime = Math.min(target, Number.isFinite(media.duration) ? media.duration : target);
  return media.currentTime;
}
