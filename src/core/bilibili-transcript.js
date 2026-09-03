const BILIBILI_API_ORIGIN = "https://api.bilibili.com";
const BILIBILI_SUBTITLE_PATHS = ["/bfs/subtitle/", "/bfs/ai_subtitle/"];

function normalizedLanguage(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll("_", "-");
}

function languagePreference(track, preferredLanguages) {
  const languageCode = normalizedLanguage(track.languageCode);
  return preferredLanguages.findIndex((language) => (
    languageCode === language
    || languageCode.startsWith(`${language}-`)
    || language.startsWith(`${languageCode}-`)
  ));
}

function bilibiliSubtitleUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").startsWith("//") ? `https:${value}` : value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || !(url.hostname === "hdslb.com" || url.hostname.endsWith(".hdslb.com"))
    || !BILIBILI_SUBTITLE_PATHS.some((path) => url.pathname.startsWith(path))
  ) return null;
  return url.href;
}

function subtitleTracks(response, preferredLanguages) {
  const normalizedLanguages = preferredLanguages
    .filter(Boolean)
    .map(normalizedLanguage);
  return (Array.isArray(response?.data?.subtitle?.subtitles)
    ? response.data.subtitle.subtitles
    : [])
    .map((track) => {
      const url = bilibiliSubtitleUrl(track?.subtitle_url);
      const languageCode = String(track?.lan ?? "").trim();
      if (!url || !languageCode) return null;
      return {
        url,
        languageCode,
        label: String(track?.lan_doc ?? languageCode).trim(),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftPreference = languagePreference(left, normalizedLanguages);
      const rightPreference = languagePreference(right, normalizedLanguages);
      if (leftPreference === -1) return rightPreference === -1 ? 0 : 1;
      if (rightPreference === -1) return -1;
      return leftPreference - rightPreference;
    });
}

function parseBilibiliCues(response) {
  if (!Array.isArray(response?.body)) return [];
  return response.body.map((item) => {
    const start = Number(item?.from);
    const end = Number(item?.to);
    const text = String(item?.content ?? "").replace(/\s+/g, " ").trim();
    if (
      !Number.isFinite(start)
      || !Number.isFinite(end)
      || start < 0
      || end < start
      || !text
    ) return null;
    return {
      startMs: Math.round(start * 1000),
      endMs: Math.round(end * 1000),
      text,
    };
  }).filter(Boolean);
}

async function responseJson(response) {
  if (!response?.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function failure(code, videoId, extra = {}) {
  return { ok: false, code, ...extra, videoId };
}

export async function readBilibiliNativeTranscript({
  fetchImpl = fetch,
  videoId = "",
  part = 1,
  preferredLanguages = [],
} = {}) {
  const normalizedVideoId = String(videoId).trim();
  const normalizedPart = Number.isInteger(part) && part > 0 ? part : 1;
  if (!normalizedVideoId) {
    return failure("BILIBILI_VIDEO_ID_MISSING", normalizedVideoId);
  }

  const viewUrl = new URL("/x/web-interface/view", BILIBILI_API_ORIGIN);
  viewUrl.searchParams.set("bvid", normalizedVideoId);

  let view;
  try {
    view = await responseJson(await fetchImpl(viewUrl.href, { credentials: "include" }));
  } catch {
    view = null;
  }
  if (view?.code !== 0) {
    return failure("BILIBILI_VIDEO_METADATA_UNAVAILABLE", normalizedVideoId);
  }

  const pages = Array.isArray(view?.data?.pages) ? view.data.pages : [];
  const page = pages.find((candidate) => Number(candidate?.page) === normalizedPart)
    ?? pages[normalizedPart - 1];
  const aid = Number(view?.data?.aid);
  const cid = Number(page?.cid);
  if (!Number.isSafeInteger(aid) || aid <= 0 || !Number.isSafeInteger(cid) || cid <= 0) {
    return failure("BILIBILI_VIDEO_PART_MISSING", normalizedVideoId);
  }

  const playerUrl = new URL("/x/player/wbi/v2", BILIBILI_API_ORIGIN);
  playerUrl.searchParams.set("aid", String(aid));
  playerUrl.searchParams.set("cid", String(cid));

  let player;
  try {
    player = await responseJson(await fetchImpl(playerUrl.href, { credentials: "include" }));
  } catch {
    player = null;
  }
  const tracks = player?.code === 0 ? subtitleTracks(player, preferredLanguages) : [];
  if (tracks.length === 0) {
    return failure("BILIBILI_SUBTITLE_TRACKS_MISSING", normalizedVideoId, { trackCount: 0 });
  }

  for (const track of tracks) {
    try {
      const body = await responseJson(await fetchImpl(track.url, { credentials: "include" }));
      const cues = parseBilibiliCues(body);
      if (cues.length > 0) {
        return {
          ok: true,
          source: "bilibili-native-subtitle-track",
          videoId: normalizedVideoId,
          languageCode: track.languageCode,
          label: track.label,
          cues,
        };
      }
    } catch {
      // Try the next trusted subtitle track.
    }
  }

  return failure("BILIBILI_NATIVE_SUBTITLE_BLOCKED", normalizedVideoId, {
    trackCount: tracks.length,
  });
}

export class BilibiliTranscriptSource {
  constructor({ readTranscript = readBilibiliNativeTranscript } = {}) {
    this.readTranscript = readTranscript;
    this.source = null;
    this.pending = null;
    this.revision = 0;
  }

  get(context) {
    if (
      context?.platform !== "bilibili"
      || this.source?.sessionId !== context.sessionId
      || this.source?.videoId !== context.videoId
    ) return null;
    return this.source;
  }

  async load(context, options = {}) {
    if (context?.platform !== "bilibili") return null;

    const cached = this.get(context);
    if (cached) return cached;
    if (this.pending?.sessionId === context.sessionId) return this.pending.promise;

    const revision = ++this.revision;
    const promise = (async () => {
      let transcript;
      try {
        transcript = await this.readTranscript({
          ...options,
          videoId: context.videoId,
          part: context.part,
        });
      } catch {
        return null;
      }
      if (
        revision !== this.revision
        || transcript?.ok !== true
        || transcript.videoId !== context.videoId
        || !Array.isArray(transcript.cues)
      ) return null;

      this.source = {
        sessionId: context.sessionId,
        videoId: context.videoId,
        groups: transcript.cues,
      };
      return this.source;
    })();
    this.pending = { sessionId: context.sessionId, promise };
    try {
      return await promise;
    } finally {
      if (this.pending?.promise === promise) this.pending = null;
    }
  }

  clear() {
    this.revision += 1;
    this.source = null;
    this.pending = null;
  }
}
