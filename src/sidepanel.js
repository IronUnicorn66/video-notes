import { formatTimestamp } from "./core/note-format.js";
import { WHISPER_MODEL, WHISPER_ORIGINS } from "./core/model-config.js";
import {
  SCREENSHOT_ORIGINS,
  friendlyMicrophoneError,
} from "./core/media-permissions.js";

const elements = {
  videoTitle: document.querySelector("#video-title"),
  videoUrl: document.querySelector("#video-url"),
  input: document.querySelector("#note-input"),
  markerTime: document.querySelector("#marker-time"),
  voiceButton: document.querySelector("#voice-button"),
  voiceLabel: document.querySelector("#voice-button-label"),
  recordingStatus: document.querySelector("#recording-status"),
  recordingTimer: document.querySelector("#recording-timer"),
  noteList: document.querySelector("#note-list"),
  emptyNotes: document.querySelector("#empty-notes"),
  exportButton: document.querySelector("#export-button"),
  whisperButton: document.querySelector("#whisper-button"),
  whisperDetail: document.querySelector("#whisper-detail"),
  settings: document.querySelector("#permission-settings"),
  screenshotPermissionButton: document.querySelector("#screenshot-permission-button"),
  screenshotPermissionDetail: document.querySelector("#screenshot-permission-detail"),
  microphonePermissionButton: document.querySelector("#microphone-permission-button"),
  microphonePermissionDetail: document.querySelector("#microphone-permission-detail"),
  keyButton: document.querySelector("#key-button"),
  toast: document.querySelector("#toast"),
};

let activeContext = null;
let currentDraft = null;
let draftPromise = null;
let isComposing = false;
let commitAfterComposition = false;
let recording = false;
let voiceStarting = false;
let pendingVoiceStopReason = null;
let recordingStartedAt = 0;
let recordingInterval = null;
let recordingTimeout = null;
let toastTimeout = null;
let editingNoteId = null;
let refreshAfterEdit = false;
let microphoneReady = false;
let microphonePermissionStatus = null;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    elements.toast.hidden = true;
  }, 3600);
}

async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? "操作失败");
  return response;
}

async function readMicrophonePermission() {
  const { microphoneReady: savedReady = false } = await chrome.storage.local.get({
    microphoneReady: false,
  });
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    if (microphonePermissionStatus !== status) {
      if (microphonePermissionStatus) microphonePermissionStatus.onchange = null;
      microphonePermissionStatus = status;
      microphonePermissionStatus.onchange = () => {
        microphoneReady = microphonePermissionStatus.state === "granted";
        void chrome.storage.local
          .set({ microphoneReady })
          .then(() => renderPermissionStatus());
      };
    }
    const ready = status.state === "granted";
    if (ready !== savedReady) await chrome.storage.local.set({ microphoneReady: ready });
    return { ready, state: status.state };
  } catch {
    return { ready: savedReady, state: savedReady ? "granted" : "prompt" };
  }
}

async function renderPermissionStatus({ expandIfNeeded = false } = {}) {
  const [screenshotGranted, microphone] = await Promise.all([
    chrome.permissions.contains({ origins: SCREENSHOT_ORIGINS }),
    readMicrophonePermission(),
  ]);
  microphoneReady = microphone.ready;

  elements.screenshotPermissionDetail.textContent = screenshotGranted
    ? "已授权。只在 YouTube 和哔哩哔哩标记时截取可见播放器。"
    : "Edge 截图接口需要一次额外授权；插件仍只在支持的视频页运行。";
  elements.screenshotPermissionButton.textContent = screenshotGranted ? "已启用" : "启用";
  elements.screenshotPermissionButton.disabled = screenshotGranted;

  elements.microphonePermissionDetail.textContent = microphone.ready
    ? "已授权。只在按住说话期间录音。"
    : microphone.state === "denied"
      ? "权限已被拒绝，请在 Edge 的扩展权限中允许后重试。"
      : "尚未授权。授权后才能使用按钮和页面快捷键录音。";
  elements.microphonePermissionButton.textContent = microphone.ready ? "已授权" : "授权";
  elements.microphonePermissionButton.disabled = microphone.ready;

  if (expandIfNeeded && (!screenshotGranted || !microphone.ready)) {
    elements.settings.open = true;
  }
}

async function grantMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前 Edge 无法访问麦克风");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    microphoneReady = true;
    await chrome.storage.local.set({ microphoneReady: true });
  } catch (error) {
    microphoneReady = false;
    await chrome.storage.local.set({ microphoneReady: false });
    throw new Error(friendlyMicrophoneError(error));
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
  await renderPermissionStatus();
}

function autoGrow() {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 260)}px`;
}

function renderNotes(notes) {
  const saved = notes.filter((note) => note.status === "saved");
  elements.noteList.replaceChildren();
  elements.emptyNotes.hidden = saved.length > 0;
  elements.exportButton.disabled = saved.length === 0;

  for (const note of saved) {
    const item = document.createElement("li");
    item.className = "note-card";
    const header = document.createElement("div");
    header.className = "note-card-header";
    const time = document.createElement("a");
    time.className = "note-time";
    time.href = note.jumpUrl;
    time.target = "_blank";
    time.textContent = formatTimestamp(note.seconds);
    const kind = document.createElement("span");
    kind.className = "note-kind";
    kind.textContent = note.inputType === "voice" ? "语音" : "文字";
    const edit = document.createElement("button");
    edit.className = "note-edit-button";
    edit.type = "button";
    edit.textContent = "编辑";
    const actions = document.createElement("span");
    actions.className = "note-card-actions";
    actions.append(kind, edit);
    header.append(time, actions);
    item.append(header);

    const body = document.createElement("p");
    body.className = "note-body";
    body.textContent = note.body || (note.inputType === "voice" ? "已保留原始录音" : "空标记");
    item.append(body);
    edit.addEventListener("click", () => {
      let canceled = false;
      editingNoteId = note.id;
      edit.disabled = true;
      body.textContent = note.body ?? "";
      body.contentEditable = "true";
      body.classList.add("is-editing");
      body.focus();
      let keyHandler;
      const finish = async () => {
        body.removeEventListener("keydown", keyHandler);
        body.contentEditable = "false";
        body.classList.remove("is-editing");
        edit.disabled = false;
        editingNoteId = null;
        if (canceled) {
          body.textContent = note.body || (note.inputType === "voice" ? "已保留原始录音" : "空标记");
          if (refreshAfterEdit) {
            refreshAfterEdit = false;
            void refresh();
          }
          return;
        }
        try {
          const response = await request({
            type: "UPDATE_NOTE_BODY",
            noteId: note.id,
            body: body.textContent,
          });
          note.body = response.note.body;
          body.textContent = note.body || (note.inputType === "voice" ? "已保留原始录音" : "空标记");
        } catch (error) {
          showToast(error.message);
        } finally {
          if (refreshAfterEdit) {
            refreshAfterEdit = false;
            void refresh();
          }
        }
      };
      body.addEventListener("blur", () => void finish(), { once: true });
      keyHandler = (event) => {
        if (event.isComposing) return;
        if (event.key === "Escape") {
          canceled = true;
          body.blur();
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          body.blur();
        }
      };
      body.addEventListener("keydown", keyHandler);
    });
    if (note.transcriptionStatus === "transcribing" || note.transcriptionStatus === "pending") {
      const pending = document.createElement("span");
      pending.className = "note-pending";
      pending.textContent = "本地转写中…";
      item.append(pending);
    }
    for (const warning of note.warnings ?? []) {
      const warningLine = document.createElement("span");
      warningLine.className = "note-pending";
      warningLine.textContent = warning;
      item.append(warningLine);
    }
    elements.noteList.append(item);
  }
}

async function refresh() {
  try {
    const response = await request({ type: "GET_ACTIVE_STATE" });
    activeContext = response.context;
    if (!activeContext) throw new Error("请打开 YouTube 或哔哩哔哩普通视频页");
    elements.videoTitle.textContent = activeContext.title;
    elements.videoUrl.href = activeContext.canonicalUrl;
    elements.videoUrl.hidden = false;
    elements.input.disabled = false;
    elements.voiceButton.disabled = false;
    renderNotes(response.notes);
  } catch (error) {
    activeContext = null;
    elements.videoTitle.textContent = error.message;
    elements.videoUrl.hidden = true;
    elements.input.disabled = true;
    elements.voiceButton.disabled = true;
    elements.exportButton.disabled = true;
    renderNotes([]);
  }
}

async function beginTypedDraft() {
  if (currentDraft || draftPromise || !activeContext) return;
  draftPromise = request({ type: "BEGIN_TYPED_NOTE" });
  try {
    const response = await draftPromise;
    currentDraft = response.note;
    elements.markerTime.textContent = formatTimestamp(currentDraft.seconds);
    elements.markerTime.hidden = false;
  } catch (error) {
    showToast(error.message);
    elements.input.blur();
  } finally {
    draftPromise = null;
  }
}

async function commitTypedDraft() {
  if (draftPromise) await draftPromise.catch(() => {});
  if (!currentDraft) return;
  const noteId = currentDraft.id;
  const body = elements.input.value.trim();
  currentDraft = null;
  elements.markerTime.hidden = true;
  elements.input.value = "";
  autoGrow();
  try {
    if (body) await request({ type: "COMMIT_TYPED_NOTE", noteId, body });
    else await request({ type: "CANCEL_NOTE", noteId });
    await refresh();
  } catch (error) {
    showToast(error.message);
  }
}

async function cancelTypedDraft() {
  if (draftPromise) await draftPromise.catch(() => {});
  if (!currentDraft) return;
  const noteId = currentDraft.id;
  currentDraft = null;
  elements.input.value = "";
  elements.markerTime.hidden = true;
  autoGrow();
  try {
    await request({ type: "CANCEL_NOTE", noteId });
  } catch (error) {
    showToast(error.message);
  }
}

function setRecordingUi(active) {
  recording = active;
  elements.recordingStatus.hidden = !active;
  elements.voiceButton.classList.toggle("is-recording", active);
  elements.voiceLabel.textContent = active ? "松开结束" : "按住说话";
  clearInterval(recordingInterval);
  clearTimeout(recordingTimeout);
  if (!active) return;
  recordingStartedAt = Date.now();
  const update = () => {
    const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
    elements.recordingTimer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  update();
  recordingInterval = setInterval(update, 250);
  recordingTimeout = setTimeout(() => void stopVoice("timeout"), 60_000);
}

async function startVoice() {
  if (recording || voiceStarting || !activeContext) return;
  voiceStarting = true;
  try {
    if (!microphoneReady) {
      await grantMicrophonePermission();
      pendingVoiceStopReason = null;
      showToast("麦克风已授权，请再次按住说话");
      return;
    }
    await request({ type: "VOICE_START_REQUEST" });
    setRecordingUi(true);
    if (pendingVoiceStopReason) {
      const reason = pendingVoiceStopReason;
      pendingVoiceStopReason = null;
      await stopVoice(reason);
    }
  } catch (error) {
    pendingVoiceStopReason = null;
    showToast(friendlyMicrophoneError(error));
  } finally {
    voiceStarting = false;
  }
}

async function stopVoice(reason = "button-release") {
  if (voiceStarting && !recording) {
    pendingVoiceStopReason = reason;
    return;
  }
  if (!recording) return;
  setRecordingUi(false);
  try {
    await request({ type: "VOICE_STOP_REQUEST", reason });
    await refresh();
  } catch (error) {
    showToast(error.message);
  }
}

function shortcutLabel(code) {
  const labels = { AltRight: "右 Option / Alt", AltLeft: "左 Option / Alt", Space: "空格" };
  return labels[code] ?? code;
}

async function renderWhisperStatus() {
  const status = await request({ type: "GET_WHISPER_STATUS" });
  const labels = {
    disabled: ["尚未启用。首次下载约 57 MiB。", "启用", false],
    downloading: ["正在下载并校验模型，可在中断后续传。", "下载中", true],
    ready: [`${status.whisperModel ?? WHISPER_MODEL.id} 已缓存在本机。`, "已启用", true],
    recording: ["正在录音，松开后会在本机转写。", "已启用", true],
    transcribing: ["正在本机转写，视频可继续播放。", "转写中", true],
    error: [`本地语音异常：${status.whisperError || "未知错误"}`, "重试", false],
  };
  const [detail, button, disabled] = labels[status.whisperState] ?? labels.disabled;
  elements.whisperDetail.textContent = detail;
  elements.whisperButton.textContent = button;
  elements.whisperButton.disabled = disabled;
}

elements.input.addEventListener("focus", () => void beginTypedDraft());
elements.input.addEventListener("input", autoGrow);
elements.input.addEventListener("compositionstart", () => {
  isComposing = true;
});
elements.input.addEventListener("compositionend", () => {
  isComposing = false;
  if (commitAfterComposition) {
    commitAfterComposition = false;
    void commitTypedDraft();
  }
});
elements.input.addEventListener("blur", () => {
  if (isComposing) {
    commitAfterComposition = true;
    setTimeout(() => {
      if (!commitAfterComposition) return;
      isComposing = false;
      commitAfterComposition = false;
      void commitTypedDraft();
    }, 300);
  } else {
    void commitTypedDraft();
  }
});
elements.input.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    void cancelTypedDraft().then(() => elements.input.blur());
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void commitTypedDraft().then(() => elements.input.blur());
  }
});

elements.voiceButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  elements.voiceButton.setPointerCapture(event.pointerId);
  void startVoice();
});
elements.voiceButton.addEventListener("pointerup", (event) => {
  event.preventDefault();
  void stopVoice();
});
elements.voiceButton.addEventListener("pointercancel", () => void stopVoice("pointer-cancel"));

elements.screenshotPermissionButton.addEventListener("click", async () => {
  elements.screenshotPermissionButton.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: SCREENSHOT_ORIGINS });
    if (!granted) throw new Error("截图授权已取消");
    showToast("播放器截图已启用");
  } catch (error) {
    showToast(error.message);
  } finally {
    await renderPermissionStatus();
  }
});

elements.microphonePermissionButton.addEventListener("click", async () => {
  elements.microphonePermissionButton.disabled = true;
  try {
    await grantMicrophonePermission();
    showToast("麦克风已授权");
  } catch (error) {
    showToast(friendlyMicrophoneError(error));
  } finally {
    await renderPermissionStatus();
  }
});

elements.exportButton.addEventListener("click", async () => {
  if (!activeContext) return;
  elements.exportButton.disabled = true;
  try {
    const result = await request({ type: "EXPORT_SESSION", sessionId: activeContext.sessionId });
    showToast(`已生成 ${result.noteCount} 条标记的 ZIP`);
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.exportButton.disabled = false;
  }
});

elements.whisperButton.addEventListener("click", async () => {
  elements.whisperButton.disabled = true;
  try {
    const source = await request({ type: "CHECK_BUNDLED_MODEL" });
    if (!source.bundled) {
      const granted = await chrome.permissions.request({ origins: WHISPER_ORIGINS });
      if (!granted) throw new Error("未授权下载本地语音模型");
    }
    await request({ type: "ENABLE_WHISPER" });
    showToast("本地 Whisper 已启用");
  } catch (error) {
    showToast(error.message);
  } finally {
    await renderWhisperStatus();
  }
});

elements.keyButton.addEventListener("click", () => {
  elements.keyButton.classList.add("is-listening");
  elements.keyButton.textContent = "请按一个键…";
  elements.keyButton.focus();
});
elements.keyButton.addEventListener("keydown", async (event) => {
  if (!elements.keyButton.classList.contains("is-listening")) return;
  event.preventDefault();
  if (event.code === "Escape") {
    elements.keyButton.classList.remove("is-listening");
    const { shortcutCode = "AltRight" } = await chrome.storage.local.get("shortcutCode");
    elements.keyButton.textContent = shortcutLabel(shortcutCode);
    return;
  }
  try {
    await request({ type: "SET_SHORTCUT", code: event.code });
    elements.keyButton.textContent = shortcutLabel(event.code);
    showToast(`按住说话键已改为 ${shortcutLabel(event.code)}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.keyButton.classList.remove("is-listening");
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "ACTIVE_CONTEXT_CHANGED" || message.type === "NOTE_TRANSCRIBED") {
    if (editingNoteId) refreshAfterEdit = true;
    else void refresh();
  }
  if (message.type === "VOICE_STATE_CHANGED") {
    setRecordingUi(message.recording);
    if (!message.recording) void refresh();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.whisperState || changes.whisperDownloadedBytes)) {
    void renderWhisperStatus();
  }
  if (area === "local" && changes.shortcutCode?.newValue) {
    elements.keyButton.textContent = shortcutLabel(changes.shortcutCode.newValue);
  }
  if (area === "local" && changes.microphoneReady) {
    microphoneReady = changes.microphoneReady.newValue === true;
    void renderPermissionStatus();
  }
});

window.addEventListener("pagehide", () => {
  if (recording || voiceStarting) {
    void chrome.runtime.sendMessage({ type: "CANCEL_PENDING_VOICE", reason: "sidepanel-closed" });
  }
  if (currentDraft) {
    void chrome.runtime.sendMessage({ type: "CANCEL_NOTE", noteId: currentDraft.id });
  } else if (draftPromise) {
    void draftPromise.then((response) => chrome.runtime.sendMessage({
      type: "CANCEL_NOTE",
      noteId: response.note.id,
    })).catch(() => {});
  }
});

const { shortcutCode = "AltRight" } = await chrome.storage.local.get("shortcutCode");
elements.keyButton.textContent = shortcutLabel(shortcutCode);
await Promise.all([
  refresh(),
  renderWhisperStatus(),
  renderPermissionStatus({ expandIfNeeded: true }),
]);
