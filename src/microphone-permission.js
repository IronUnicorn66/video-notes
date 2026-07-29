import { verifyMicrophoneAccess } from "./core/microphone-access.js";
import { localizeRuntimeMessage, translate } from "./core/i18n.js";
import {
  INTERFACE_LANGUAGE_KEY,
  localizeDocument,
  readInterfaceLanguage,
} from "./core/extension-language.js";

const interfaceLanguage = await readInterfaceLanguage(
  chrome.storage.local,
  chrome.i18n.getUILanguage(),
);
const t = (key, variables) => translate(interfaceLanguage, key, variables);
localizeDocument(document, interfaceLanguage);

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
  if (!response?.ok) throw new Error(response?.error ?? t("cannotReturnToVideo"));
  if (!response.returned) {
    setStatus(t("sourcePageUnavailable"), { error: true });
    return false;
  }
  setStatus(t("returningToVideo"));
  setTimeout(() => void closePermissionTab(), 700);
  return true;
}

async function readPermission() {
  try {
    const permission = await navigator.permissions.query({ name: "microphone" });
    if (permission.state === "granted") {
      await saveReady(true);
      button.disabled = true;
      button.textContent = t("authorized");
      await returnToSourceTab();
    } else if (permission.state === "denied") {
      await saveReady(false, t("microphonePermissionDenied"));
      setStatus(t("microphoneDeniedInEdge"), {
        error: true,
      });
    }
  } catch {
    // Permissions API 不可用时仍允许用户通过按钮发起浏览器授权。
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  setStatus(t("waitingForMicrophone"));
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(t("edgeMicrophoneUnavailable"));
    await verifyMicrophoneAccess(
      navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
    );
    await saveReady(true);
    button.textContent = t("authorizationSucceeded");
    await returnToSourceTab();
  } catch (error) {
    const message = localizeRuntimeMessage(
      interfaceLanguage,
      error?.message ?? error ?? t("authorizationFailed"),
    );
    await saveReady(false, message);
    setStatus(t("authorizationFailedWithMessage", { message }), { error: true });
    button.disabled = false;
    button.textContent = t("authorizeAgain");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local"
    && changes[INTERFACE_LANGUAGE_KEY]?.newValue
    && changes[INTERFACE_LANGUAGE_KEY].newValue !== interfaceLanguage
  ) {
    location.reload();
  }
});

await readPermission();
