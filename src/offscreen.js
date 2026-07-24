import createWhisperModule from "@transcribe/shout";
import { FileTranscriber } from "@transcribe/transcriber";

import { WHISPER_MODEL } from "./core/model-config.js";
import { buildMarkdown, makeAssetFilename, sanitizeFilename } from "./core/note-format.js";
import { VideoNotesRepository } from "./core/storage.js";
import { applyTranscript } from "./core/whisper-state.js";
import { createZip } from "./core/zip.js";

const repository = new VideoNotesRepository();
const MODEL_CHUNK_SIZE = 4 * 1024 * 1024;
let recorder = null;
let mediaStream = null;
let audioChunks = [];
let recordingNoteId = null;
let transcriber = null;
let transcriberPromise = null;
let recordingCanTranscribe = false;
let recordingTimeout = null;
let recordingStarting = false;
let recordingAbortRequested = false;
let recordingStopping = false;
let stoppingNoteId = null;
let recordingStopPromise = null;
let modelDownloading = false;
let transcriptionTail = Promise.resolve();
const transcriptionJobs = new Map();

async function backgroundRequest(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, target: "background", ...payload });
  if (!response?.ok) throw new Error(response?.error ?? "后台服务没有响应");
  return response;
}

async function getLocalStorage(keys) {
  return (await backgroundRequest("OFFSCREEN_STORAGE_GET", { keys })).values;
}

async function setLocalStorage(values) {
  await backgroundRequest("OFFSCREEN_STORAGE_SET", { values });
}

async function removeLocalStorage(keys) {
  await backgroundRequest("OFFSCREEN_STORAGE_REMOVE", { keys });
}

function releaseRecordingResources() {
  clearTimeout(recordingTimeout);
  recordingTimeout = null;
  for (const track of mediaStream?.getTracks() ?? []) track.stop();
  recorder = null;
  mediaStream = null;
  audioChunks = [];
  recordingNoteId = null;
  recordingCanTranscribe = false;
}

function supportedAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

async function setWhisperState(whisperState, extra = {}) {
  await setLocalStorage({ whisperState, ...extra });
}

async function modelCache() {
  return caches.open(WHISPER_MODEL.cacheName);
}

async function bundledModelResponse() {
  try {
    const response = await fetch(chrome.runtime.getURL(`models/${WHISPER_MODEL.filename}`));
    return response.ok ? response : undefined;
  } catch {
    return undefined;
  }
}

function chunkCacheKey(offset) {
  return `${WHISPER_MODEL.url}?video-notes-chunk=${offset}`;
}

async function clearModelChunks(cache) {
  for (let offset = 0; offset < WHISPER_MODEL.size; offset += MODEL_CHUNK_SIZE) {
    await cache.delete(chunkCacheKey(offset));
  }
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(buffer) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)));
}

async function cachedModelResponse() {
  const cached = await (await modelCache()).match(WHISPER_MODEL.url);
  if (cached) return cached;
  return bundledModelResponse();
}

async function downloadModel() {
  const cache = await modelCache();
  const existing = await cache.match(WHISPER_MODEL.url);
  if (existing) {
    return { model: WHISPER_MODEL.id, cached: true };
  }

  const bundled = await bundledModelResponse();
  if (bundled) {
    const bytes = await bundled.arrayBuffer();
    if (bytes.byteLength !== WHISPER_MODEL.size || await sha256(bytes) !== WHISPER_MODEL.sha256) {
      throw new Error("内置模型校验失败");
    }
    await cache.put(
      WHISPER_MODEL.url,
      new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }),
    );
    return { model: WHISPER_MODEL.id, cached: true, bundled: true };
  }

  const chunks = [];
  let downloadedBytes = 0;
  for (let offset = 0; offset < WHISPER_MODEL.size; offset += MODEL_CHUNK_SIZE) {
    const end = Math.min(offset + MODEL_CHUNK_SIZE, WHISPER_MODEL.size) - 1;
    const key = chunkCacheKey(offset);
    let response = await cache.match(key);
    if (!response) {
      response = await fetch(WHISPER_MODEL.url, {
        cache: "no-store",
        headers: { Range: `bytes=${offset}-${end}` },
      });
      if (!response.ok) throw new Error(`模型下载失败（HTTP ${response.status}）`);
      const received = await response.arrayBuffer();
      if (response.status === 200 && received.byteLength === WHISPER_MODEL.size) {
        chunks.length = 0;
        chunks.push(new Uint8Array(received));
        downloadedBytes = received.byteLength;
        break;
      }
      const expectedLength = end - offset + 1;
      if (response.status !== 206 || received.byteLength !== expectedLength) {
        throw new Error(`模型分块长度异常：期望 ${expectedLength}，收到 ${received.byteLength}`);
      }
      response = new Response(received, { headers: { "Content-Type": "application/octet-stream" } });
      await cache.put(key, response.clone());
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    chunks.push(bytes);
    downloadedBytes += bytes.byteLength;
    await setLocalStorage({ whisperDownloadedBytes: downloadedBytes });
  }

  const modelBytes = new Uint8Array(downloadedBytes);
  let position = 0;
  for (const chunk of chunks) {
    modelBytes.set(chunk, position);
    position += chunk.byteLength;
  }
  if (modelBytes.byteLength !== WHISPER_MODEL.size) {
    await clearModelChunks(cache);
    throw new Error(`模型大小校验失败：${modelBytes.byteLength}`);
  }
  const digest = await sha256(modelBytes.buffer);
  if (digest !== WHISPER_MODEL.sha256) {
    await clearModelChunks(cache);
    throw new Error("模型 SHA-256 校验失败");
  }

  await cache.put(
    WHISPER_MODEL.url,
    new Response(modelBytes, { headers: { "Content-Type": "application/octet-stream" } }),
  );
  await clearModelChunks(cache);
  await removeLocalStorage("whisperDownloadedBytes");
  return { model: WHISPER_MODEL.id, cached: false };
}

async function downloadAndEnableModel() {
  if (modelDownloading) throw new Error("模型正在下载");
  modelDownloading = true;
  await setWhisperState("downloading", { whisperError: "" });
  try {
    const result = await downloadModel();
    await setWhisperState("ready", {
      whisperModel: result.model,
      whisperError: "",
    });
    return result;
  } catch (error) {
    await setWhisperState("error", { whisperError: error.message });
    throw error;
  } finally {
    modelDownloading = false;
  }
}

async function ensureTranscriber() {
  if (transcriber?.isReady) return transcriber;
  if (transcriberPromise) return transcriberPromise;

  transcriberPromise = (async () => {
    if (!crossOriginIsolated) throw new Error("扩展页面未启用 SharedArrayBuffer 隔离");
    const response = await cachedModelResponse();
    if (!response) throw new Error("本地语音模型尚未下载");
    const file = new File([await response.blob()], WHISPER_MODEL.filename, {
      type: "application/octet-stream",
    });
    const instance = new FileTranscriber({
      createModule: createWhisperModule,
      model: file,
      print: () => {},
      printErr: (message) => console.warn("Whisper", message),
    });
    instance.Module.mainScriptUrlOrBlob = chrome.runtime.getURL("shout-worker.js");
    await instance.init();
    transcriber = instance;
    return instance;
  })();

  try {
    return await transcriberPromise;
  } finally {
    transcriberPromise = null;
  }
}

async function startRecording(noteId) {
  if (recordingStarting || recordingStopping || recorder?.state === "recording") {
    throw new Error("已有录音正在进行或保存");
  }
  recordingStarting = true;
  recordingAbortRequested = false;
  recordingNoteId = noteId;
  try {
    const [{ whisperModel = "" }, model] = await Promise.all([
      getLocalStorage({ whisperModel: "" }),
      cachedModelResponse(),
    ]);
    recordingCanTranscribe = Boolean(whisperModel && model);
    if (whisperModel && !model) {
      await setWhisperState("error", {
        whisperError: "本地语音模型缓存已丢失，请重新启用",
      }).catch(() => {});
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (recordingAbortRequested) throw new Error("录音启动已取消");
    audioChunks = [];
    const mimeType = supportedAudioMimeType();
    recorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    });
    await new Promise((resolve, reject) => {
      recorder.addEventListener("start", resolve, { once: true });
      recorder.addEventListener("error", () => reject(recorder.error ?? new Error("录音启动失败")), {
        once: true,
      });
      recorder.start(250);
    });
  } catch (error) {
    releaseRecordingResources();
    throw error;
  } finally {
    recordingStarting = false;
    recordingAbortRequested = false;
  }
  recordingTimeout = setTimeout(() => {
    void chrome.runtime.sendMessage({ type: "RECORDING_TIMEOUT" });
  }, 60_000);
  if (recordingCanTranscribe) await setWhisperState("recording").catch(() => {});
  return { noteId };
}

async function stopRecording() {
  if (recordingStopPromise) return recordingStopPromise;
  recordingStopPromise = stopRecordingCore();
  try {
    return await recordingStopPromise;
  } finally {
    recordingStopPromise = null;
  }
}

async function stopRecordingCore() {
  if (recordingStopping) throw new Error("录音正在保存");
  if (!recorder || recorder.state === "inactive" || !recordingNoteId) {
    throw new Error("当前没有正在进行的录音");
  }
  recordingStopping = true;
  const noteId = recordingNoteId;
  const shouldTranscribe = recordingCanTranscribe;
  stoppingNoteId = noteId;
  const mimeType = recorder.mimeType || "audio/webm";
  const stopped = new Promise((resolve, reject) => {
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.addEventListener("error", () => reject(recorder.error ?? new Error("录音停止失败")), {
      once: true,
    });
  });
  try {
    let audio;
    const audioKey = `audio/${noteId}`;
    try {
      recorder.stop();
      await stopped;
      audio = new Blob(audioChunks, { type: mimeType });
      await repository.putAsset(audioKey, audio);
    } finally {
      releaseRecordingResources();
    }

    const whisperReady = shouldTranscribe && Boolean(
      await cachedModelResponse().catch(() => undefined),
    );
    await repository.updateNote(noteId, (note) => ({
      ...note,
      audioKey,
      status: "saved",
      transcriptionStatus: whisperReady ? "transcribing" : "disabled",
      updatedAt: Date.now(),
    }));
    if (whisperReady) await setWhisperState("transcribing").catch(() => {});
    return { noteId, audioKey, whisperReady, size: audio.size, mimeType };
  } finally {
    recordingStopping = false;
    stoppingNoteId = null;
  }
}

async function abortRecording() {
  if (recordingStarting && (!recorder || recorder.state === "inactive")) {
    recordingAbortRequested = true;
    return { aborted: true, pending: true, noteId: recordingNoteId };
  }
  if (!recorder || recorder.state === "inactive") {
    releaseRecordingResources();
    return { aborted: false };
  }
  const noteId = recordingNoteId;
  const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  try {
    recorder.stop();
    await stopped;
  } finally {
    releaseRecordingResources();
  }
  if (await cachedModelResponse()) await syncWhisperActivity();
  return { aborted: true, noteId };
}

async function transcribeNote(noteId) {
  try {
    const note = await repository.getNote(noteId);
    if (!note?.audioKey) throw new Error("没有找到原始录音");
    const audio = await repository.getAsset(note.audioKey);
    if (!audio) throw new Error("原始录音已丢失");
    const engine = await ensureTranscriber();
    const result = await engine.transcribe(
      new File([audio], `${noteId}.webm`, { type: audio.type || "audio/webm" }),
      {
        lang: "zh",
        threads: Math.min(4, navigator.hardwareConcurrency || 2),
        token_timestamps: false,
        suppress_non_speech: true,
      },
    );
    const text = (result.transcription ?? []).map((segment) => segment.text).join("").trim();
    await repository.updateNote(noteId, (latest) => ({
      ...applyTranscript(latest, text),
      updatedAt: Date.now(),
    }));
    void chrome.runtime.sendMessage({ type: "NOTE_TRANSCRIBED", noteId }).catch(() => {});
    return { noteId, text };
  } catch (error) {
    await repository.updateNote(noteId, (note) => ({
      ...note,
      transcriptionStatus: "error",
      warnings: [...(note.warnings ?? []), `转写失败：${error.message}`],
      updatedAt: Date.now(),
    })).catch(() => {});
    throw error;
  }
}

async function syncWhisperActivity(error = null) {
  try {
    if (recordingStarting || recorder?.state === "recording") {
      await setWhisperState("recording");
    } else if (transcriptionJobs.size > 0) {
      await setWhisperState("transcribing");
    } else if (error) {
      await setWhisperState("error", { whisperError: error.message });
    } else {
      await setWhisperState("ready", { whisperError: "" });
    }
  } catch {
    // 状态展示失败不能改变已经保存的录音或转写结果。
  }
}

function enqueueTranscription(noteId) {
  if (transcriptionJobs.has(noteId)) return transcriptionJobs.get(noteId);
  const task = transcriptionTail.then(() => transcribeNote(noteId));
  transcriptionTail = task.catch(() => {});
  const tracked = task.then(
    async (result) => {
      transcriptionJobs.delete(noteId);
      await syncWhisperActivity();
      return result;
    },
    async (error) => {
      transcriptionJobs.delete(noteId);
      await syncWhisperActivity(error);
      throw error;
    },
  );
  transcriptionJobs.set(noteId, tracked);
  if (!recordingStarting && recorder?.state !== "recording") {
    void setWhisperState("transcribing");
  }
  return tracked;
}

async function exportSession(sessionId) {
  const session = await repository.getSession(sessionId);
  if (!session) throw new Error("没有找到要导出的会话");
  const notes = (await repository.listNotes(sessionId)).filter((note) => note.status === "saved");
  const files = [];
  const exportNotes = [];

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const exportNote = { ...note };
    if (note.screenshotKey) {
      const image = await repository.getAsset(note.screenshotKey);
      if (image) {
        exportNote.imageFilename = `images/${makeAssetFilename(index + 1, note.seconds, "webp")}`;
        files.push({ name: exportNote.imageFilename, data: new Uint8Array(await image.arrayBuffer()) });
      } else {
        exportNote.warnings = [...(exportNote.warnings ?? []), "截图资产缺失"];
      }
    }
    if (note.audioKey) {
      const audio = await repository.getAsset(note.audioKey);
      if (audio) {
        exportNote.audioFilename = `audio/${makeAssetFilename(index + 1, note.seconds, "webm")}`;
        files.push({ name: exportNote.audioFilename, data: new Uint8Array(await audio.arrayBuffer()) });
      } else {
        exportNote.warnings = [...(exportNote.warnings ?? []), "录音资产缺失"];
      }
    }
    exportNotes.push(exportNote);
  }

  const safeTitle = sanitizeFilename(session.title);
  files.unshift({ name: `${safeTitle}.md`, data: buildMarkdown(session, exportNotes) });
  const zip = createZip(files);
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  try {
    const { downloadId } = await backgroundRequest("OFFSCREEN_DOWNLOAD", {
      url,
      filename: `${safeTitle}-视频笔记.zip`,
    });
    return { downloadId, noteCount: notes.length };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function handleMessage(message) {
  switch (message.type) {
    case "GET_RECORDING_STATE":
      return {
        recording: recorder?.state === "recording",
        starting: recordingStarting,
        stopping: recordingStopping,
        noteId: recordingNoteId ?? stoppingNoteId,
      };
    case "GET_PROCESSING_STATE":
      return {
        recording: recorder?.state === "recording",
        starting: recordingStarting,
        stopping: recordingStopping,
        downloading: modelDownloading,
        transcriptionNoteIds: [...transcriptionJobs.keys()],
        modelCached: Boolean(await cachedModelResponse()),
      };
    case "START_RECORDING":
      return startRecording(message.noteId);
    case "STOP_RECORDING":
      return stopRecording();
    case "ABORT_RECORDING":
      return abortRecording();
    case "DOWNLOAD_MODEL":
      return downloadAndEnableModel();
    case "CHECK_BUNDLED_MODEL":
      return { bundled: Boolean(await bundledModelResponse()) };
    case "TRANSCRIBE_NOTE":
      return enqueueTranscription(message.noteId);
    case "EXPORT_SESSION":
      return exportSession(message.sessionId);
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;
  void handleMessage(message).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});
