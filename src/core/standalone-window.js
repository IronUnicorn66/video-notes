import { parseVideoContext } from "./site-adapter.js";

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 800;

function validTabId(value) {
  return Number.isInteger(value) && value >= 0;
}

function sameExtensionPage(candidate, expected) {
  return candidate.protocol === expected.protocol
    && candidate.host === expected.host
    && candidate.pathname === expected.pathname;
}

export function standalonePanelUrl(panelUrl, tabId) {
  if (!validTabId(tabId)) throw new Error("缺少有效视频标签页");
  const url = new URL(panelUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "standalone");
  url.searchParams.set("tabId", String(tabId));
  return url.href;
}

export function standaloneTabIdFromUrl(documentUrl, panelUrl) {
  try {
    const candidate = new URL(documentUrl);
    const expected = new URL(panelUrl);
    if (!sameExtensionPage(candidate, expected)) return null;
    if (candidate.searchParams.get("mode") !== "standalone") return null;
    const rawTabId = candidate.searchParams.get("tabId") ?? "";
    if (!/^\d+$/.test(rawTabId)) return null;
    const tabId = Number(rawTabId);
    return validTabId(tabId) ? tabId : null;
  } catch {
    return null;
  }
}

function standaloneContext(context, panelUrl) {
  if (
    !["TAB", "POPUP"].includes(context?.contextType)
    || !validTabId(context.tabId)
    || !validTabId(context.windowId)
    || standaloneTabIdFromUrl(context.documentUrl, panelUrl) === null
  ) return null;
  return {
    documentUrl: context.documentUrl,
    tabId: context.tabId,
    windowId: context.windowId,
  };
}

export function createStandaloneWindowManager({
  panelUrl,
  runtime,
  tabs,
  windows,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}) {
  let knownWindow = null;
  let queue = Promise.resolve();

  async function discover() {
    if (knownWindow) return knownWindow;
    const contexts = await runtime.getContexts({ contextTypes: ["TAB", "POPUP"] });
    knownWindow = contexts
      .map((context) => standaloneContext(context, panelUrl))
      .find(Boolean) ?? null;
    return knownWindow;
  }

  async function focusExisting(existing, targetUrl) {
    const currentTargetTabId = standaloneTabIdFromUrl(existing.documentUrl, panelUrl);
    const update = currentTargetTabId === standaloneTabIdFromUrl(targetUrl, panelUrl)
      ? { active: true }
      : { active: true, url: targetUrl };
    try {
      await tabs.update(existing.tabId, update);
      await windows.update(existing.windowId, { focused: true });
      knownWindow = { ...existing, documentUrl: targetUrl };
      return { reused: true, tabId: existing.tabId, windowId: existing.windowId };
    } catch {
      knownWindow = null;
      return null;
    }
  }

  async function openNow(targetTab) {
    if (
      !validTabId(targetTab?.id)
      || !validTabId(targetTab?.windowId)
      || !parseVideoContext(targetTab?.url)
    ) {
      throw new Error("请先打开支持的视频页面");
    }
    const targetUrl = standalonePanelUrl(panelUrl, targetTab.id);
    const existing = await discover();
    if (existing) {
      const focused = await focusExisting(existing, targetUrl);
      if (focused) return focused;
    }

    const created = await windows.create({
      focused: true,
      height,
      type: "popup",
      url: targetUrl,
      width,
    });
    if (!validTabId(created?.id)) {
      throw new Error("独立窗口打开失败");
    }
    const createdTabId = created.tabs?.[0]?.id
      ?? (await tabs.query({ windowId: created.id }))[0]?.id;
    if (!validTabId(createdTabId)) throw new Error("独立窗口打开失败");
    knownWindow = {
      documentUrl: targetUrl,
      tabId: createdTabId,
      windowId: created.id,
    };
    return { reused: false, tabId: createdTabId, windowId: created.id };
  }

  return {
    open(targetTab) {
      const operation = queue.catch(() => {}).then(() => openNow(targetTab));
      queue = operation;
      return operation;
    },
  };
}
