export function seekMediaForVideoContext({
  media,
  context,
  seconds,
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
  const target = Number(seconds);
  if (!Number.isFinite(target) || target < 0) throw new Error("无效的视频时间点");
  media.currentTime = Math.min(target, Number.isFinite(media.duration) ? media.duration : target);
  return media.currentTime;
}
