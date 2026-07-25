import { getWhisperModel } from "./model-config.js";

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

export function sanitizeFilename(value) {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|#]/g, "-")
    .replace(/-+/g, "-")
    .replace(/-\s*$/, "")
    .trim()
    .slice(0, 100) || "视频笔记";
}

function escapeHeading(value) {
  return String(value ?? "未命名视频").replace(/([\\`*_{}\[\]()<>#+.!|-])/g, "\\$1");
}

function escapeLinkLabel(value) {
  return String(value).replace(/([\\\[\]])/g, "\\$1");
}

function whisperModelLabel(modelId) {
  try {
    return getWhisperModel(modelId).label;
  } catch {
    return String(modelId ?? "未知模型");
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

export function buildMarkdown(session, entries) {
  const lines = [
    `# ${escapeHeading(session.title)}`,
    "",
    `- 平台：${session.platform}`,
    `- 原始网址：[打开视频](${session.canonicalUrl})`,
    "",
  ];

  entries.forEach((entry, index) => {
    const timestamp = formatTimestamp(entry.seconds);
    lines.push(`## ${pad(index + 1, 3)} · [${timestamp}](${entry.jumpUrl})`, "");

    if (entry.body?.trim()) lines.push(entry.body.trim(), "");
    if (entry.imageFilename) {
      lines.push(`![${escapeLinkLabel(timestamp)} 截图](${entry.imageFilename})`, "");
    }
    if (entry.audioFilename) {
      lines.push(`[原始录音](${entry.audioFilename})`, "");
    }
    const transcriptionRuns = entry.transcriptionRuns ?? [];
    if (transcriptionRuns.length > 0) {
      lines.push(
        "<details>",
        `<summary>本地转写结果（${transcriptionRuns.length} 个模型）</summary>`,
        "",
      );
      for (const run of transcriptionRuns) {
        lines.push(`- ${whisperModelLabel(run.modelId)}：${formatTranscriptListItem(run.text)}`);
      }
      lines.push("", "</details>", "");
    } else if (entry.transcriptCandidate?.trim()) {
      lines.push(
        "<details>",
        "<summary>语音转写候选</summary>",
        "",
        escapeTranscriptText(entry.transcriptCandidate),
        "",
        "</details>",
        "",
      );
    }
    for (const warning of entry.warnings ?? []) {
      lines.push(`> ⚠ ${warning}`, "");
    }
    if (entry.subtitleContext?.trim()) {
      lines.push("### 前置字幕", "", `> ${entry.subtitleContext.trim().replace(/\n/g, "\n> ")}`, "");
    }
  });

  return `${lines.join("\n").trimEnd()}\n`;
}
