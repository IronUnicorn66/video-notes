export const SCREENSHOT_ORIGINS = Object.freeze(["<all_urls>"]);

export function canUseMicrophone(savedReady, permissionState) {
  return savedReady === true && permissionState === "granted";
}

function errorMessage(error) {
  return String(error?.message ?? error ?? "操作失败");
}

export function isMicrophonePermissionError(error) {
  return (
    error?.name === "NotAllowedError" ||
    /permission (dismissed|denied)|notallowederror|microphone.*permission/i.test(errorMessage(error))
  );
}

export function friendlyMicrophoneError(error) {
  if (isMicrophonePermissionError(error)) {
    return "请先在侧栏的权限设置中授权麦克风";
  }
  return errorMessage(error);
}

export function friendlyCaptureError(error) {
  const message = errorMessage(error);
  if (/<all_urls>|activeTab.*permission|permission.*activeTab/i.test(message)) {
    return "请在侧栏的权限设置中启用播放器截图";
  }
  return message;
}
