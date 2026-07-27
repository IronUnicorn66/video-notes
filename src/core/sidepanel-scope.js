import { parseVideoContext } from "./site-adapter.js";

export function contextChangedSenderTab(sender) {
  return Number.isInteger(sender?.tab?.id) ? sender.tab : null;
}

export function sidePanelMessageForTabUpdate(tabId, changeInfo, tab) {
  if (
    !Number.isInteger(tabId)
    || changeInfo?.status !== "complete"
    || tab?.active !== true
    || !tab.url
    || !parseVideoContext(tab.url)
  ) {
    return null;
  }
  return { type: "TAB_LOAD_COMPLETE", tabId };
}

export function isSidePanelRefreshMessage(message) {
  return [
    "ACTIVE_CONTEXT_CHANGED",
    "TAB_LOAD_COMPLETE",
    "NOTE_TRANSCRIBED",
    "VOICE_STATE_CHANGED",
  ].includes(message?.type);
}

export function sidePanelTabIdForSender(sender, contexts, fallbackTabId = null) {
  const context = contexts.find((candidate) => (
    candidate.contextType === "SIDE_PANEL"
    && candidate.documentId === sender?.documentId
    && Number.isInteger(candidate.tabId)
    && candidate.tabId >= 0
  ));
  return context?.tabId
    ?? (Number.isInteger(fallbackTabId) && fallbackTabId >= 0 ? fallbackTabId : null);
}

export function createSidePanelRefreshController(refresh, {
  onContextEvent = () => {},
  shouldRefresh = () => true,
  shouldDeferRefresh = () => false,
} = {}) {
  let tabId = null;
  let deferredMessage = null;

  function refreshOrDefer(message) {
    onContextEvent(message);
    if (!shouldRefresh(message)) return false;
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
      if (message?.type === "ACTIVE_CONTEXT_CHANGED" && Number.isInteger(message.tabId)) {
        tabId = message.tabId;
      }
      if (!Number.isInteger(tabId) || message?.tabId !== tabId) return false;
      refreshOrDefer(message);
      return true;
    },
    handleVisibilityChange(visible) {
      if (!visible || !Number.isInteger(tabId)) return false;
      refreshOrDefer({ type: "SIDE_PANEL_VISIBLE", tabId });
      return true;
    },
    requestRefresh(message) {
      return refreshOrDefer(message);
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
