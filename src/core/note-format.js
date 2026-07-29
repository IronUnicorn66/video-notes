import { getWhisperModel } from "./model-config.js";
import { localizeRuntimeMessage, translate } from "./i18n.js";

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function timestampParts(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60];
}

export function formatTimestamp(seconds, separator = ":") {
  return timestampParts(seconds).map((value) => pad(value)).join(separator);
}

export function makeAssetFilename(index, seconds, extension) {
  return `${pad(index, 3)}_${formatTimestamp(seconds, "-")}.${extension}`;
}

export function makeExportFilenames(title, language = "zh_CN") {
  const safeTitle = sanitizeFilename(title, translate(language, "productName"));
  return {
    markdown: `${safeTitle}.md`,
    archive: `${safeTitle}-${translate(language, "exportArchiveSuffix")}.zip`,
  };
}

export function sanitizeFilename(value, fallback = "视频笔记") {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|#]/g, "-")
    .replace(/-+/g, "-")
    .replace(/-\s*$/, "")
    .trim()
    .slice(0, 100) || fallback;
}

function escapeHeading(value, language) {
  return String(value ?? translate(language, "untitledVideo"))
    .replace(/([\\`*_{}\[\]()<>#+.!|-])/g, "\\$1");
}

function escapeLinkLabel(value) {
  return String(value).replace(/([\\\[\]])/g, "\\$1");
}

function whisperModelLabel(modelId, language) {
  try {
    return getWhisperModel(modelId).label;
  } catch {
    return String(modelId ?? translate(language, "unknownModel"));
  }
}

function escapeTranscriptText(value) {
  return String(value ?? "")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTranscriptListItem(value) {
  return escapeTranscriptText(value).replace(/\n/g, "\n  ");
}

export function buildMarkdown(session, entries, { language = "zh_CN" } = {}) {
  const lines = [
    `# ${escapeHeading(session.title, language)}`,
    "",
    `- ${translate(language, "markdownPlatform", { platform: session.platform })}`,
    `- ${translate(language, "markdownOriginalUrl", {
      label: translate(language, "markdownOpenVideo"),
      url: session.canonicalUrl,
    })}`,
    "",
  ];

  entries.forEach((entry, index) => {
    const timestamp = formatTimestamp(entry.seconds);
    lines.push(`## ${pad(index + 1, 3)} · [${timestamp}](${entry.jumpUrl})`, "");

    if (entry.body?.trim()) lines.push(entry.body.trim(), "");
    if (entry.imageFilename) {
      lines.push(`![${translate(language, "markdownScreenshotAlt", {
        timestamp: escapeLinkLabel(timestamp),
      })}](${entry.imageFilename})`, "");
    }
    if (entry.audioFilename) {
      lines.push(`[${translate(language, "markdownOriginalRecording")}](${entry.audioFilename})`, "");
    }
    const transcriptionRuns = entry.transcriptionRuns ?? [];
    if (transcriptionRuns.length > 0) {
      lines.push(
        "<details>",
        `<summary>${translate(language, "markdownTranscriptionRuns", {
          count: transcriptionRuns.length,
        })}</summary>`,
        "",
      );
      for (const run of transcriptionRuns) {
        const separator = language === "en" ? ": " : "：";
        lines.push(`- ${whisperModelLabel(run.modelId, language)}${separator}${formatTranscriptListItem(run.text)}`);
      }
      lines.push("", "</details>", "");
    } else if (entry.transcriptCandidate?.trim()) {
      lines.push(
        "<details>",
        `<summary>${translate(language, "markdownTranscriptCandidate")}</summary>`,
        "",
        escapeTranscriptText(entry.transcriptCandidate),
        "",
        "</details>",
        "",
      );
    }
    for (const warning of entry.warnings ?? []) {
      lines.push(`> ⚠ ${localizeRuntimeMessage(language, warning)}`, "");
    }
    if (entry.subtitleContext?.trim()) {
      lines.push(
        `### ${translate(language, "markdownLeadInSubtitles")}`,
        "",
        `> ${entry.subtitleContext.trim().replace(/\n/g, "\n> ")}`,
        "",
      );
    }
  });

  return `${lines.join("\n").trimEnd()}\n`;
}
