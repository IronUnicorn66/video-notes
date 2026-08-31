function readBalancedJson(source, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function extractAssignedJson(source, variableName) {
  const assignment = new RegExp(`(?:var\\s+)?${variableName}\\s*=\\s*`);
  const match = assignment.exec(source);
  if (!match) return null;
  const start = source.indexOf("{", match.index + match[0].length);
  if (start === -1) return null;
  const json = readBalancedJson(source, start);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function captionLabel(name) {
  if (name?.simpleText) return name.simpleText.trim();
  return (name?.runs ?? []).map((run) => run.text ?? "").join("").trim();
}

function languagePreference(track, preferredLanguages) {
  const languageCode = track.languageCode.toLowerCase();
  return preferredLanguages.findIndex((language) => (
    languageCode === language || languageCode.startsWith(`${language}-`)
  ));
}

export function extractYoutubeCaptionTracks(scripts, preferredLanguages = []) {
  const normalizedLanguages = preferredLanguages
    .filter(Boolean)
    .map((language) => language.toLowerCase().replaceAll("_", "-"));
  for (const script of scripts) {
    const source = script.textContent ?? "";
    if (!source.includes("ytInitialPlayerResponse")) continue;
    const response = extractAssignedJson(source, "ytInitialPlayerResponse");
    const captionTracks = response?.captions
      ?.playerCaptionsTracklistRenderer
      ?.captionTracks;
    if (!Array.isArray(captionTracks)) continue;
    return captionTracks
      .filter((track) => track.baseUrl && track.languageCode)
      .map((track) => ({
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        label: captionLabel(track.name) || track.languageCode,
        automatic: track.kind === "asr",
      }))
      .sort((left, right) => {
        if (left.automatic !== right.automatic) return Number(left.automatic) - Number(right.automatic);
        const leftPreference = languagePreference(left, normalizedLanguages);
        const rightPreference = languagePreference(right, normalizedLanguages);
        if (leftPreference === -1) return rightPreference === -1 ? 0 : 1;
        if (rightPreference === -1) return -1;
        return leftPreference - rightPreference;
      });
  }
  return [];
}

function normalizedCue(startMs, durationMs, text) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) return null;
  return {
    startMs,
    endMs: startMs + durationMs,
    text: normalizedText,
  };
}

export function parseYoutubeJson3Transcript(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  return (parsed.events ?? [])
    .map((event) => normalizedCue(
      Number(event.tStartMs ?? 0),
      Number(event.dDurationMs ?? 0),
      (event.segs ?? []).map((segment) => segment.utf8 ?? "").join(""),
    ))
    .filter(Boolean);
}

function decodeXmlText(text) {
  return text.replace(/&#(x?[0-9a-f]+);|&(amp|lt|gt|quot|apos);/gi, (entity, numeric, named) => {
    if (numeric) {
      const radix = numeric[0].toLowerCase() === "x" ? 16 : 10;
      return String.fromCodePoint(Number.parseInt(radix === 16 ? numeric.slice(1) : numeric, radix));
    }
    return {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
    }[named.toLowerCase()];
  });
}

export function parseYoutubeXmlTranscript(body) {
  const cues = [];
  const textPattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  for (const match of body.matchAll(textPattern)) {
    const attributes = match[1];
    const start = /\bstart="([^"]+)"/.exec(attributes)?.[1];
    const duration = /\bdur="([^"]+)"/.exec(attributes)?.[1];
    if (start === undefined) continue;
    const cue = normalizedCue(
      Math.round(Number.parseFloat(start) * 1000),
      Math.round(Number.parseFloat(duration ?? "0") * 1000),
      decodeXmlText(match[2].replace(/<[^>]*>/g, "")),
    );
    if (cue) cues.push(cue);
  }
  return cues;
}

function transcriptRequests(baseUrl) {
  const json3Url = new URL(baseUrl);
  json3Url.searchParams.set("fmt", "json3");
  return [
    { format: "json3", url: json3Url.href },
    { format: "xml", url: baseUrl },
  ];
}

export function parseYoutubeTranscriptBody(body, format) {
  if (format === "json3" || body.trimStart().startsWith("{")) {
    return parseYoutubeJson3Transcript(body);
  }
  return parseYoutubeXmlTranscript(body);
}

export function transcriptFromYoutubeCapture(capture) {
  if (!capture?.ok || !capture.body || !capture.url) return null;
  let url;
  try {
    url = new URL(capture.url);
  } catch {
    return null;
  }
  const cues = parseYoutubeTranscriptBody(capture.body, url.searchParams.get("fmt") ?? "");
  if (cues.length === 0) return null;
  const languageCode = url.searchParams.get("lang") ?? "";
  return {
    ok: true,
    source: "youtube-player-caption-response",
    languageCode,
    label: url.searchParams.get("name") ?? languageCode,
    automatic: url.searchParams.get("kind") === "asr",
    cues,
  };
}

export function transcriptResultAfterPlayerCapture(nativeResult, capture) {
  const transcript = transcriptFromYoutubeCapture(capture);
  if (transcript) return transcript;
  return {
    ...nativeResult,
    playerCaptureCode: capture?.code ?? "YOUTUBE_PLAYER_CAPTURE_INVALID",
  };
}

export async function readYoutubeFullTranscript(root, {
  fetchImpl = fetch,
  preferredLanguages = [],
} = {}) {
  const scripts = root.scripts ?? root.querySelectorAll?.("script") ?? [];
  const tracks = extractYoutubeCaptionTracks(scripts, preferredLanguages);
  if (tracks.length === 0) {
    return {
      ok: false,
      code: "YOUTUBE_CAPTION_TRACKS_MISSING",
      trackCount: 0,
    };
  }

  const attempts = [];
  for (const track of tracks) {
    for (const request of transcriptRequests(track.baseUrl)) {
      try {
        const response = await fetchImpl(request.url, { credentials: "include" });
        const body = await response.text();
        const cues = response.ok ? parseYoutubeTranscriptBody(body, request.format) : [];
        attempts.push({
          languageCode: track.languageCode,
          format: request.format,
          status: response.status,
          byteLength: body.length,
        });
        if (cues.length > 0) {
          return {
            ok: true,
            source: "youtube-native-caption-track",
            languageCode: track.languageCode,
            label: track.label,
            automatic: track.automatic,
            cues,
          };
        }
      } catch {
        attempts.push({
          languageCode: track.languageCode,
          format: request.format,
          status: 0,
          byteLength: 0,
        });
      }
    }
  }

  return {
    ok: false,
    code: "YOUTUBE_NATIVE_CAPTION_BLOCKED",
    trackCount: tracks.length,
    attempts,
  };
}
