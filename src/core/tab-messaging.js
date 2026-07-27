export function isMissingTabReceiverError(error) {
  return String(error?.message ?? error).includes("Receiving end does not exist");
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
        await ensureContentScript(tabId);
        return tabs.sendMessage(tabId, message);
      }
    },
  };
}
