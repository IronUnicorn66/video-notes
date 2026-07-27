import createWhisperModule from "@transcribe/shout";
import { FileTranscriber } from "@transcribe/transcriber";

import { WHISPER_MODEL, WHISPER_MODELS, getWhisperModel } from "./core/model-config.js";
import { createModelDownloader } from "./core/model-download.js";
import { buildMarkdown, makeAssetFilename, sanitizeFilename } from "./core/note-format.js";
import { VideoNotesRepository } from "./core/storage.js";
import { persistRecordedNote } from "./core/note-history-commands.js";
import { createTranscriberManager } from "./core/transcriber-manager.js";
import { createWhisperOperationLock } from "./core/whisper-operation.js";
import {
  applyTranscript,
  assertModelSwitchAllowed,
  canTranscribeWithWhisper,
} from "./core/whisper-state.js";
import { createZip } from "./core/zip.js";

const repository = new VideoNotesRepository();
let recorder = null;
let mediaStream = null;
let audioChunks = [];
let recordingNoteId = null;
let recordingWhisperModel = null;
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
const whisperModelOperationLock = createWhisperOperationLock();

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
  recordingWhisperModel = null;
  recordingCanTranscribe = false;
}

function supportedAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

async function setWhisperState(whisperState, extra = {}) {
  await setLocalStorage({ whisperState, ...extra });
}

async function bundledModelResponse(model = WHISPER_MODEL) {
  if (model.id !== WHISPER_MODEL.id) return undefined;
  try {
    const response = await fetch(chrome.runtime.getURL(`models/${model.filename}`));
    return response.ok ? response : undefined;
  } catch {
    return undefined;
  }
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(buffer) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)));
}

const modelDownloader = createModelDownloader({
  openCache: (cacheName) => caches.open(cacheName),
  fetchResource: (...args) => fetch(...args),
  digest: sha256,
  readBundled: bundledModelResponse,
  onProgress: ({ modelId, downloadedBytes }) => setLocalStorage({
    whisperDownloadModel: modelId,
    whisperDownloadedBytes: downloadedBytes,
  }),
  clearProgress: () => removeLocalStorage(["whisperDownloadModel", "whisperDownloadedBytes"]),
});

async function cachedModelResponse(model = WHISPER_MODEL) {
  const cached = await (await caches.open(model.cacheName)).match(model.url);
  if (cached) return cached;
  return bundledModelResponse(model);
}

async function downloadAndEnableModel(modelId = WHISPER_MODEL.id) {
  assertModelSwitchAllowed(processingState());
  modelDownloading = true;
  await setWhisperState("downloading", { whisperError: "" });
  try {
    const result = await modelDownloader.download(getWhisperModel(modelId));
    await transcriberManager.dispose();
    await setWhisperState("ready", {
      whisperSelectedModel: result.model,
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

function processingState() {
  return {
    whisperState: modelDownloading
      ? "downloading"
      : recordingStarting || recordingStopping || recorder?.state === "recording"
        ? "recording"
        : transcriptionJobs.size > 0
          ? "transcribing"
          : "ready",
    modelDownloading,
    transcriptionCount: transcriptionJobs.size,
    recording: recordingStarting || recordingStopping || recorder?.state === "recording",
  };
}

async function createFileTranscriber(modelId) {
  if (!crossOriginIsolated) throw new Error("扩展页面未启用 SharedArrayBuffer 隔离");
  const model = getWhisperModel(modelId);
  const response = await cachedModelResponse(model);
  if (!response) throw new Error(`尚未下载 ${model.label}`);
  const file = new File([await response.blob()], model.filename, {
    type: "application/octet-stream",
  });
  const instance = new FileTranscriber({
    createModule: createWhisperModule,
    model: file,
    print: () => {},
    printErr: (message) => console.warn("Whisper", message),
  });
  instance.Module.mainScriptUrlOrBlob = chrome.runtime.getURL("shout-worker.js");
  try {
    await instance.init();
    return instance;
  } catch (error) {
    await instance.destroy?.();
    throw error;
  }
}

const transcriberManager = createTranscriberManager({ create: createFileTranscriber });

async function ensureTranscriber(modelId) {
  return transcriberManager.ensure(modelId);
}

async function selectWhisperModel(modelId) {
  assertModelSwitchAllowed(processingState());
  const model = getWhisperModel(modelId);
  if (!await modelDownloader.cached(model)) throw new Error(`尚未下载 ${model.label}`);
  await transcriberManager.dispose();
  await setWhisperState("ready", { whisperSelectedModel: model.id, whisperError: "" });
  return { modelId: model.id };
}

async function startRecording(noteId) {
  if (recordingStarting || recordingStopping || recorder?.state === "recording") {
    throw new Error("已有录音正在进行或保存");
  }
  recordingStarting = true;
  recordingAbortRequested = false;
  recordingNoteId = noteId;
  try {
    const { whisperSelectedModel = "", whisperState = "disabled" } = await getLocalStorage({
      whisperSelectedModel: "",
      whisperState: "disabled",
    });
    recordingWhisperModel = whisperSelectedModel ? getWhisperModel(whisperSelectedModel) : null;
    const model = recordingWhisperModel && await cachedModelResponse(recordingWhisperModel);
    recordingCanTranscribe = canTranscribeWithWhisper({
      whisperState,
      modelCached: Boolean(recordingWhisperModel && model),
    });
    if (whisperState === "ready" && recordingWhisperModel && !model) {
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
  const whisperModel = recordingWhisperModel;
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
    } finally {
      releaseRecordingResources();
    }

    const whisperReady = shouldTranscribe && Boolean(
      await cachedModelResponse(whisperModel ?? WHISPER_MODEL).catch(() => undefined),
    );
    await persistRecordedNote({
      repository,
      noteId,
      audio,
      audioKey,
      transcriptionStatus: whisperReady ? "pending" : "disabled",
    });
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
  const whisperModel = recordingWhisperModel;
  const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  try {
    recorder.stop();
    await stopped;
  } finally {
    releaseRecordingResources();
  }
  if (await cachedModelResponse(whisperModel ?? WHISPER_MODEL)) await syncWhisperActivity();
  return { aborted: true, noteId };
}

async function transcribeNote(noteId, modelId, source) {
  try {
    const note = await repository.getNote(noteId);
    if (!note?.audioKey) throw new Error("没有找到原始录音");
    await repository.updateNote(noteId, (latest) => ({
      ...latest,
      transcriptionStatus: "transcribing",
      updatedAt: Date.now(),
    }));
    const audio = await repository.getAsset(note.audioKey);
    if (!audio) throw new Error("原始录音已丢失");
    const engine = await ensureTranscriber(getWhisperModel(modelId).id);
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
    const transcribedNote = await repository.updateNote(noteId, (latest) => ({
      ...applyTranscript(latest, text, { modelId, source }),
      updatedAt: Date.now(),
    }));
    void chrome.runtime.sendMessage({
      type: "NOTE_TRANSCRIBED",
      noteId,
      tabId: transcribedNote.tabId,
    }).catch(() => {});
    return { noteId, text };
  } catch (error) {
    await repository.updateNote(noteId, (note) => ({
      ...note,
      pendingTranscription: null,
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

function enqueueTranscription(noteId, modelId, source) {
  getWhisperModel(modelId);
  if (!["automatic", "manual"].includes(source)) throw new Error("未知转写来源");
  const existing = transcriptionJobs.get(noteId);
  if (existing) return existing.promise;
  const job = { noteId, modelId, source };
  const task = transcriptionTail.then(() => transcribeNote(job.noteId, job.modelId, job.source));
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
  transcriptionJobs.set(noteId, { ...job, promise: tracked });
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
    case "GET_MICROPHONE_PERMISSION": {
      try {
        const status = await navigator.permissions.query({ name: "microphone" });
        return { state: status.state };
      } catch {
        return { state: "unknown" };
      }
    }
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
        loadedModelId: transcriberManager.loadedModelId,
      };
    case "GET_MODEL_CACHE_STATUS":
      return { cachedModelIds: await modelDownloader.cachedIds(WHISPER_MODELS) };
    case "START_RECORDING":
      return startRecording(message.noteId);
    case "STOP_RECORDING":
      return stopRecording();
    case "ABORT_RECORDING":
      return abortRecording();
    case "DOWNLOAD_MODEL":
      return whisperModelOperationLock.run(() => downloadAndEnableModel(message.modelId));
    case "SELECT_WHISPER_MODEL":
      return whisperModelOperationLock.run(() => selectWhisperModel(message.modelId));
    case "CHECK_BUNDLED_MODEL":
      return { bundled: Boolean(await bundledModelResponse()) };
    case "TRANSCRIBE_NOTE":
      return enqueueTranscription(message.noteId, message.modelId, message.source);
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
