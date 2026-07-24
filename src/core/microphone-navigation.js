const RETURN_TAB_KEY = "microphonePermissionReturnTabId";

export function createMicrophoneNavigation({ storageSession, tabs, windows }) {
  return {
    async rememberSource(tab) {
      if (tab?.id >= 0) await storageSession.set({ [RETURN_TAB_KEY]: tab.id });
    },

    async returnToSource() {
      const { [RETURN_TAB_KEY]: returnTabId = -1 } = await storageSession.get({
        [RETURN_TAB_KEY]: -1,
      });
      if (returnTabId < 0) return { returned: false };
      try {
        const tab = await tabs.update(returnTabId, { active: true });
        if (tab?.windowId >= 0) await windows.update(tab.windowId, { focused: true });
        return { returned: true };
      } catch {
        return { returned: false };
      } finally {
        await storageSession.remove([RETURN_TAB_KEY]).catch(() => {});
      }
    },
  };
}
