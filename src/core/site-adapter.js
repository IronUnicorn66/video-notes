const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const BILIBILI_HOSTS = new Set(["bilibili.com", "www.bilibili.com"]);

function positiveInteger(value, fallback = 1) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function parseVideoContext(url, title = "未命名视频") {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (YOUTUBE_HOSTS.has(parsed.hostname) && parsed.pathname === "/watch") {
    const videoId = parsed.searchParams.get("v")?.trim();
    if (!videoId) return null;

    return {
      platform: "youtube",
      sessionId: `youtube:${videoId}`,
      videoId,
      part: 1,
      title,
      canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    };
  }

  if (BILIBILI_HOSTS.has(parsed.hostname)) {
    const match = parsed.pathname.match(/^\/video\/(BV[0-9A-Za-z]+)/i);
    if (!match) return null;

    const videoId = match[1];
    const part = positiveInteger(parsed.searchParams.get("p"));
    return {
      platform: "bilibili",
      sessionId: `bilibili:${videoId}:${part}`,
      videoId,
      part,
      title,
      canonicalUrl: `https://www.bilibili.com/video/${videoId}?p=${part}`,
    };
  }

  return null;
}

export function buildJumpUrl(context, seconds) {
  const time = Math.max(0, Math.floor(Number(seconds) || 0));
  if (context.platform === "youtube") {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(context.videoId)}&t=${time}s`;
  }
  if (context.platform === "bilibili") {
    return `https://www.bilibili.com/video/${context.videoId}?p=${context.part}&t=${time}`;
  }
  throw new Error(`不支持的平台：${context.platform}`);
}

