export const SCREENSHOT_ORIGINS = Object.freeze(["<all_urls>"]);

function errorMessage(error) {
  return String(error?.message ?? error ?? "操作失败");
}

export function friendlyCaptureError(error) {
  const message = errorMessage(error);
  if (/<all_urls>|activeTab.*permission|permission.*activeTab/i.test(message)) {
    return "请在侧栏的权限设置中启用播放器截图";
  }
  return message;
}
