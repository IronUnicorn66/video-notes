export function isMissingTabReceiverError(error) {
  return String(error?.message ?? error).includes("Receiving end does not exist");
}

function isBlockedTabAccessError(error) {
  return String(error?.message ?? error).trim() === "Blocked";
}

export function createTabMessenger({ tabs, scripting, contentScript = "content.js" }) {
  const pendingInjections = new Map();

  async function ensureContentScript(tabId) {
    let injection = pendingInjections.get(tabId);
    if (!injection) {
      injection = Promise.resolve().then(() => scripting.executeScript({
        target: { tabId },
        files: [contentScript],
      }));
      pendingInjections.set(tabId, injection);
    }
    try {
      await injection;
    } finally {
      if (pendingInjections.get(tabId) === injection) pendingInjections.delete(tabId);
    }
  }

  return {
    async send(tabId, message) {
      try {
        return await tabs.sendMessage(tabId, message);
      } catch (error) {
        if (!isMissingTabReceiverError(error)) throw error;
        try {
          await ensureContentScript(tabId);
        } catch (injectionError) {
          if (isBlockedTabAccessError(injectionError)) {
            throw new Error("Edge 已暂停当前站点的扩展，请在工具栏扩展菜单中开启“允许在当前网站使用扩展”，然后刷新页面");
          }
          throw injectionError;
        }
        return tabs.sendMessage(tabId, message);
      }
    },
  };
}
