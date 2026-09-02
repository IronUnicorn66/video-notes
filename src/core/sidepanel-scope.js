import { parseVideoContext } from "./site-adapter.js";

export function contextChangedSenderTab(sender) {
  return Number.isInteger(sender?.tab?.id) ? sender.tab : null;
}

function validContextId(value) {
  return Number.isInteger(value) && value >= 0;
}

export function activeContextChangedMessage(tabId, windowId) {
  if (!validContextId(tabId) || !validContextId(windowId)) return null;
  return { type: "ACTIVE_CONTEXT_CHANGED", tabId, windowId };
}

export function sidePanelContextForSender(sender, contexts, fallbackTab = null) {
  const context = contexts.find((candidate) => (
    candidate.contextType === "SIDE_PANEL"
    && candidate.documentId === sender?.documentId
  ));
  const contextWindowId = validContextId(context?.windowId) ? context.windowId : null;
  const fallbackMatchesWindow = contextWindowId === null
    || fallbackTab?.windowId === contextWindowId;

  return {
    tabId: validContextId(context?.tabId)
      ? context.tabId
      : fallbackMatchesWindow && validContextId(fallbackTab?.id) ? fallbackTab.id : null,
    windowId: contextWindowId
      ?? (validContextId(fallbackTab?.windowId) ? fallbackTab.windowId : null),
  };
}

export function createActiveTabActivationHandler({
  tabs,
  runtime,
  configureSidePanelForTab,
  onError = () => {},
}) {
  return async ({ tabId, windowId }) => {
    let tab;
    try {
      tab = await tabs.get(tabId);
      await configureSidePanelForTab(tab);
      const message = activeContextChangedMessage(tabId, windowId);
      if (message) await runtime.sendMessage(message).catch(() => {});
    } catch (error) {
      onError(tab ?? { id: tabId }, error);
    }
  };
}

export function createCurrentPageContextReader({
  targetTab,
  sendPageContextRequest,
}) {
  return async (request) => {
    const tab = await targetTab(request);
    if (!tab?.url || !parseVideoContext(tab.url)) return null;
    const response = await sendPageContextRequest(tab.id);
    return response?.context ?? null;
  };
}

export function createSidePanelScrollMemory({
  readPosition,
  restorePosition,
}) {
  const positions = new Map();
  let activeTabId = null;
  let pendingRestoreTabId = null;

  function normalizedPosition(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  return {
    activateTab(tabId) {
      if (!validContextId(tabId) || tabId === activeTabId) return false;
      if (activeTabId !== null) {
        positions.set(activeTabId, normalizedPosition(readPosition()));
      }
      activeTabId = tabId;
      pendingRestoreTabId = tabId;
      return true;
    },
    restoreTab(tabId) {
      if (tabId !== activeTabId || tabId !== pendingRestoreTabId) return false;
      pendingRestoreTabId = null;
      restorePosition(positions.get(tabId) ?? 0);
      return true;
    },
  };
}

export function createSidePanelContextResolver({ runtime, tabs }) {
  return async (sender) => {
    const contexts = await runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
    let context = sidePanelContextForSender(sender, contexts);
    let fallbackTab = null;

    if (context.tabId === null) {
      const query = context.windowId === null
        ? { active: true, lastFocusedWindow: true }
        : { active: true, windowId: context.windowId };
      [fallbackTab] = await tabs.query(query);
    } else if (context.windowId === null) {
      fallbackTab = await tabs.get(context.tabId);
    }
    if (fallbackTab) context = sidePanelContextForSender(sender, contexts, fallbackTab);
    if (context.tabId === null || context.windowId === null) {
      throw new Error("无法确定侧栏所属标签页");
    }
    return { context, contexts, fallbackTab };
  };
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

export function sidePanelRequestTabIdForSender(
  sender,
  contexts,
  fallbackTabId,
  requestedTabId,
) {
  const tabId = sidePanelTabIdForSender(sender, contexts, fallbackTabId);

  if (tabId === null) {
    throw new Error("无法确定侧栏所属标签页");
  }

  if (!Number.isInteger(requestedTabId) || requestedTabId !== tabId) {
    throw new Error("侧栏所属标签页已变化");
  }

  return tabId;
}

export function createSidePanelRefreshController(refresh, {
  onContextEvent = () => {},
  onTabChanged = () => {},
  shouldRefresh = () => true,
  shouldDeferRefresh = () => false,
} = {}) {
  let tabId = null;
  let windowId = null;
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
    get windowId() {
      return windowId;
    },
    setTabId(value, ownerWindowId) {
      tabId = validContextId(value) ? value : null;
      if (arguments.length > 1) {
        windowId = validContextId(ownerWindowId) ? ownerWindowId : null;
      }
    },
    handleContextChanged(message) {
      if (message?.type === "ACTIVE_CONTEXT_CHANGED") {
        if (
          !validContextId(message.tabId)
          || !validContextId(message.windowId)
          || message.windowId !== windowId
        ) return false;
        const previousTabId = tabId;
        tabId = message.tabId;
        if (tabId !== previousTabId) onTabChanged(previousTabId, tabId);
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

export function createExistingSidePanelOptionsConfigurator({
  tabs,
  sidePanel,
  warn = console.warn,
}) {
  return async () => {
    let openTabs;
    try {
      openTabs = await tabs.query({});
    } catch (error) {
      warn("查询现有标签页以配置侧栏失败", error);
      return;
    }

    await Promise.all(openTabs
      .filter((tab) => Number.isInteger(tab.id))
      .map(async (tab) => {
        try {
          await sidePanel.setOptions(sidePanelOptionsForTab(tab));
        } catch (error) {
          warn("配置标签页侧栏失败", tab.id, error);
        }
      }));
  };
}
