import { buildMarkdown, formatTimestamp, makeAssetFilename, makeExportFilenames } from "./note-format.js";
import { cachedFullTranscriptForContext } from "./full-transcript-cache.js";
import { buildJumpUrl } from "./site-adapter.js";
import { translate } from "./i18n.js";

function subtitleTime(milliseconds) {
  const value = Math.round(milliseconds);
  return `${formatTimestamp(value / 1000)},${String(value % 1000).padStart(3, "0")}`;
}

function markdownText(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1");
}

// A track is exported verbatim; its coverage does not prove that every spoken word is present.
export function buildTranscriptExport(session, transcript, language = "zh_CN") {
  const valid = cachedFullTranscriptForContext({
    schemaVersion: 1,
    id: session.id,
    videoId: session.videoId,
    transcript,
  }, { sessionId: session.id, videoId: session.videoId });
  if (!valid) return null;
  const cues = valid.cues.map((cue, index) => ({
    id: `cue-${String(index + 1).padStart(6, "0")}`,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
    jumpUrl: buildJumpUrl(session, cue.startMs / 1000),
  }));
  const metadata = {
    schemaVersion: 1,
    sessionId: session.id,
    platform: session.platform,
    videoId: session.videoId,
    part: session.part,
    title: session.title,
    canonicalUrl: session.canonicalUrl,
    source: valid.source,
    languageCode: valid.languageCode ?? "",
    label: valid.label ?? "",
    automatic: typeof valid.automatic === "boolean" ? valid.automatic : null,
    timingUnit: "milliseconds",
    segmentation: "source-cues",
    coverage: {
      cueCount: cues.length,
      startMs: cues.reduce((start, cue) => Math.min(start, cue.startMs), Infinity),
      endMs: cues.reduce((end, cue) => Math.max(end, cue.endMs), 0),
      completeness: "source-track-not-verified-against-audio",
    },
    cues,
  };
  const srt = cues.map((cue, index) => (
    `${index + 1}\n${subtitleTime(cue.startMs)} --> ${subtitleTime(cue.endMs)}\n${cue.text.replace(/\r\n?/g, "\n").replace(/\n\s*\n/g, "\n")}\n`
  )).join("\n");
  const lines = [
    `# ${translate(language, "exportTranscriptTitle")}`,
    "",
    `[${markdownText(session.title)}](${session.canonicalUrl})`,
    "",
    translate(language, "exportTranscriptSource", { language: metadata.languageCode || "unknown", count: cues.length }),
    "",
    translate(language, "exportTranscriptCoverage"),
    "",
  ];
  for (const cue of cues) {
    lines.push(`## [${subtitleTime(cue.startMs)} → ${subtitleTime(cue.endMs)}](${cue.jumpUrl})`, "",
      `> ${markdownText(cue.text).replace(/\r\n?/g, "\n").replace(/\n/g, "\n> ")}`, "");
  }
  return {
    metadata,
    files: [
      { name: "transcript/original.json", data: `${JSON.stringify(metadata, null, 2)}\n` },
      { name: "transcript/original.srt", data: srt },
      { name: "transcript/original.md", data: `${lines.join("\n").trimEnd()}\n` },
    ],
  };
}

export async function buildSessionExport({ repository, session, transcript = null, language = "zh_CN" }) {
  const notes = (await repository.listNotes(session.id)).filter((note) => note.status === "saved");
  const files = [];
  const exportNotes = [];
  for (const [index, note] of notes.entries()) {
    const entry = { ...note, warnings: [...(note.warnings ?? [])] };
    for (const [key, field, directory, extension, warning] of [
      ["screenshotKey", "imageFilename", "images", "webp", "missingScreenshotAsset"],
      ["audioKey", "audioFilename", "audio", "webm", "missingAudioAsset"],
    ]) {
      if (!note[key]) continue;
      const asset = await repository.getAsset(note[key]);
      if (asset) {
        entry[field] = `${directory}/${makeAssetFilename(index + 1, note.seconds, extension)}`;
        files.push({ name: entry[field], data: new Uint8Array(await asset.arrayBuffer()) });
      } else {
        entry.warnings.push(translate(language, warning));
      }
    }
    exportNotes.push(entry);
  }
  const transcriptExport = buildTranscriptExport(session, transcript, language);
  const filenames = makeExportFilenames(session.title, language);
  const transcriptNotice = transcriptExport
    ? `${translate(language, "exportTranscriptIncluded")}\n\n[Markdown](transcript/original.md) · [JSON](transcript/original.json) · [SRT](transcript/original.srt)`
    : translate(language, "exportTranscriptMissing");
  files.unshift({
    name: filenames.markdown,
    data: `${buildMarkdown(session, exportNotes, { language })}\n## ${translate(language, "exportTranscriptTitle")}\n\n${transcriptNotice}\n`,
  });
  files.push(...(transcriptExport?.files ?? []));
  files.push({
    name: "export.json",
    data: `${JSON.stringify({
      schemaVersion: 1,
      kind: "video-notes-export",
      session,
      notesFile: filenames.markdown,
      noteCount: notes.length,
      transcript: transcriptExport ? {
        status: "included",
        jsonFile: "transcript/original.json",
        srtFile: "transcript/original.srt",
        markdownFile: "transcript/original.md",
        languageCode: transcriptExport.metadata.languageCode,
        ...transcriptExport.metadata.coverage,
      } : { status: "unavailable", cueCount: 0 },
    }, null, 2)}\n`,
  });
  return { files, filenames, noteCount: notes.length, transcriptCueCount: transcriptExport?.metadata.cues.length ?? 0 };
}
