import { buildSessionExport } from "./core/session-export.js";
import { VideoNotesRepository } from "./core/storage.js";
import { createZip } from "./core/zip.js";

const repository = new VideoNotesRepository();

async function exportSession(message) {
  const result = await buildSessionExport({
    repository,
    session: message.session,
    transcript: message.transcript,
    language: message.language,
  });
  const zip = createZip(result.files);
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  try {
    const response = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_DOWNLOAD",
      target: "background",
      url,
      filename: result.filenames.archive,
    });
    if (!response?.ok) throw new Error(response?.error ?? "后台服务没有响应");
    return { downloadId: response.downloadId, noteCount: result.noteCount, transcriptCueCount: result.transcriptCueCount };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen" || message.type !== "EXPORT_SESSION") return false;
  if (sender.id !== chrome.runtime.id) return false;
  void exportSession(message).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});
