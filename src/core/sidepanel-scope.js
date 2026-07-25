import { parseVideoContext } from "./site-adapter.js";

export function contextChangedSenderTab(sender) {
  return Number.isInteger(sender?.tab?.id) ? sender.tab : null;
}

export function sidePanelTabIdForSender(sender, contexts) {
  const context = contexts.find((candidate) => (
    candidate.contextType === "SIDE_PANEL"
    && candidate.documentId === sender?.documentId
    && Number.isInteger(candidate.tabId)
  ));
  return context?.tabId ?? null;
}

export function createSidePanelRefreshController(refresh, { shouldDeferRefresh = () => false } = {}) {
  let tabId = null;
  let deferredMessage = null;

  function refreshOrDefer(message) {
    if (shouldDeferRefresh(message)) {
      deferredMessage = message;
      return false;
    }
    refresh(message);
    return true;
  }

  return {
    get tabId() {
      return tabId;
    },
    setTabId(value) {
      tabId = Number.isInteger(value) ? value : null;
    },
    handleContextChanged(message) {
      if (!Number.isInteger(tabId) || message?.tabId !== tabId) return false;
      refreshOrDefer(message);
      return true;
    },
    handleVisibilityChange(visible) {
      if (!visible || !Number.isInteger(tabId)) return false;
      refreshOrDefer({ type: "SIDE_PANEL_VISIBLE", tabId });
      return true;
    },
    flushDeferredRefresh() {
      if (!deferredMessage) return false;
      const message = deferredMessage;
      deferredMessage = null;
      refresh(message);
      return true;
    },
  };
}

export function sidePanelOptionsForTab(tab) {
  if (!Number.isInteger(tab?.id)) throw new Error("缺少有效 tabId");
  const supported = Boolean(tab.url && parseVideoContext(tab.url));
  return supported
    ? { tabId: tab.id, path: "sidepanel.html", enabled: true }
    : { tabId: tab.id, enabled: false };
}
