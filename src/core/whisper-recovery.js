export function recoverWhisperState({
  whisperState,
  cachedModelIds,
  selectedModelId,
  processing,
}) {
  const modelAvailable = cachedModelIds.includes(selectedModelId);
  const transientStates = new Set(["downloading", "recording", "transcribing"]);

  if (processing?.downloading) return { whisperState: "downloading", whisperError: "" };
  if (processing?.recording || processing?.starting || processing?.stopping) {
    return { whisperState: "recording", whisperError: "" };
  }
  if (processing?.transcriptionNoteIds?.length) {
    return { whisperState: "transcribing", whisperError: "" };
  }
  if (transientStates.has(whisperState)) {
    return modelAvailable
      ? { whisperState: "ready", whisperError: "" }
      : { whisperState: "error", whisperError: "上次本地语音任务中断，请重新启用" };
  }
  if (whisperState === "ready" && !modelAvailable) {
    return { whisperState: "error", whisperError: "本地语音模型缓存已丢失，请重新启用" };
  }
  if (whisperState === "disabled") return { whisperState: "disabled", whisperError: "" };
  if (whisperState === "ready") return { whisperState: "ready", whisperError: "" };
  return { whisperState, whisperError: undefined };
}
