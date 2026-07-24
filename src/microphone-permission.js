import { verifyMicrophoneAccess } from "./core/microphone-access.js";

const button = document.querySelector("#grant-microphone-button");
const status = document.querySelector("#permission-status");

function setStatus(message, { error = false } = {}) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

async function saveReady(ready, error = "") {
  await chrome.storage.local.set({
    microphoneReady: ready,
    microphoneLastError: error,
  });
}

async function closePermissionTab() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) await chrome.tabs.remove(tab.id);
}

async function returnToSourceTab() {
  const response = await chrome.runtime.sendMessage({ type: "MICROPHONE_PERMISSION_GRANTED" });
  if (!response?.ok) throw new Error(response?.error ?? "无法返回原视频页面");
  if (!response.returned) {
    setStatus("麦克风已授权，但原视频页面已经关闭，请手动返回课程页面。", { error: true });
    return false;
  }
  setStatus("授权成功，正在返回视频页面…");
  setTimeout(() => void closePermissionTab(), 700);
  return true;
}

async function readPermission() {
  try {
    const permission = await navigator.permissions.query({ name: "microphone" });
    if (permission.state === "granted") {
      await saveReady(true);
      button.disabled = true;
      button.textContent = "已授权";
      await returnToSourceTab();
    } else if (permission.state === "denied") {
      await saveReady(false, "麦克风权限已被拒绝");
      setStatus("Edge 已拒绝麦克风权限，请在地址栏权限设置中改为允许后重试。", {
        error: true,
      });
    }
  } catch {
    // Permissions API 不可用时仍允许用户通过按钮发起浏览器授权。
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  setStatus("等待 Edge 麦克风权限确认…");
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前 Edge 无法访问麦克风");
    await verifyMicrophoneAccess(
      navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
    );
    await saveReady(true);
    button.textContent = "授权成功";
    await returnToSourceTab();
  } catch (error) {
    const message = String(error?.message ?? error ?? "授权失败");
    await saveReady(false, message);
    setStatus(`授权失败：${message}`, { error: true });
    button.disabled = false;
    button.textContent = "重新授权";
  }
});

await readPermission();
