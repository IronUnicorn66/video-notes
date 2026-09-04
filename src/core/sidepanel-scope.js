import { parseVideoContext } from "./site-adapter.js";
import { standaloneTabIdFromUrl } from "./standalone-window.js";

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

export function createSidePanelContextResolver({ runtime, tabs, panelUrl = "" }) {
  return async (sender) => {
    const standaloneTabId = standaloneTabIdFromUrl(sender?.url, panelUrl);
    if (standaloneTabId !== null) {
      let targetTab = null;
      try {
        targetTab = await tabs.get(standaloneTabId);
      } catch {
        // 独立窗口保留原绑定，以便原标签关闭后显示明确的不可用状态。
      }
      return {
        context: {
          mode: "standalone",
          tabId: standaloneTabId,
          windowId: validContextId(targetTab?.windowId) ? targetTab.windowId : null,
        },
        contexts: [],
        fallbackTab: targetTab,
      };
    }

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
    return {
      context: { mode: "sidepanel", ...context },
      contexts,
      fallbackTab,
    };
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
    "BOUND_TAB_CHANGED",
    "BOUND_TAB_REMOVED",
    "NOTES_CHANGED",
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
  activeTab,
  requestedTabId,
) {
  const context = sidePanelContextForSender(sender, contexts);
  const boundTabId = context.tabId;
  const activeTabMatchesWindow = validContextId(activeTab?.id)
    && (context.windowId === null || activeTab.windowId === context.windowId);

  if (boundTabId === null && !activeTabMatchesWindow) {
    throw new Error("无法确定侧栏所属标签页");
  }

  if (
    !validContextId(requestedTabId)
    || (
      requestedTabId !== boundTabId
      && (!activeTabMatchesWindow || requestedTabId !== activeTab.id)
    )
  ) {
    throw new Error("侧栏所属标签页已变化");
  }

  return requestedTabId;
}

export function activeSidePanelRequestTabId(context, activeTab, requestedTabId) {
  if (
    !validContextId(context?.windowId)
    || !validContextId(activeTab?.id)
    || activeTab.windowId !== context.windowId
  ) {
    throw new Error("无法确定侧栏所属标签页");
  }
  if (!validContextId(requestedTabId) || requestedTabId !== activeTab.id) {
    throw new Error("侧栏所属标签页已变化");
  }
  return requestedTabId;
}

export function standalonePanelRequestTabId(context, requestedTabId) {
  if (
    context?.mode !== "standalone"
    || !validContextId(context.tabId)
    || !validContextId(requestedTabId)
    || requestedTabId !== context.tabId
  ) {
    throw new Error("独立窗口绑定的视频已变化");
  }
  return requestedTabId;
}

export async function activateStandaloneTargetTab(tabs, context, targetTab) {
  if (context?.mode !== "standalone") return targetTab;
  if (!validContextId(targetTab?.id) || !validContextId(targetTab?.windowId)) {
    throw new Error("原视频标签页已关闭");
  }
  const [activeTab] = await tabs.query({ active: true, windowId: targetTab.windowId });
  if (activeTab?.id === targetTab.id) return targetTab;
  return tabs.update(targetTab.id, { active: true });
}

export function createSidePanelRefreshController(refresh, {
  onContextEvent = () => {},
  onTabChanged = () => {},
  shouldRefresh = () => true,
  shouldDeferRefresh = () => false,
} = {}) {
  let tabId = null;
  let windowId = null;
  let mode = "sidepanel";
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
    get mode() {
      return mode;
    },
    setContext(context) {
      mode = context?.mode === "standalone" ? "standalone" : "sidepanel";
      tabId = validContextId(context?.tabId) ? context.tabId : null;
      windowId = validContextId(context?.windowId) ? context.windowId : null;
    },
    setTabId(value, ownerWindowId) {
      tabId = validContextId(value) ? value : null;
      if (arguments.length > 1) {
        windowId = validContextId(ownerWindowId) ? ownerWindowId : null;
      }
    },
    handleContextChanged(message) {
      if (message?.type === "ACTIVE_CONTEXT_CHANGED") {
        if (mode === "standalone") {
          if (!Number.isInteger(tabId) || message.tabId !== tabId) return false;
          refreshOrDefer(message);
          return true;
        }
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
