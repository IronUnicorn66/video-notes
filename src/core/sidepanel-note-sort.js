import { createNoteSortController } from "./note-sort-controller.js";

export function createSidepanelNoteSortBinding({
  buttons,
  storage,
  getNotes,
  renderNotes,
  isEditing,
  showToast,
}) {
  let pendingRender = false;

  function renderOrder(order) {
    for (const button of buttons) {
      const active = button.dataset.noteSortOrder === order;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function renderCurrentNotes(order) {
    renderNotes(getNotes(), order);
  }

  const controller = createNoteSortController({
    initialOrder: "newest",
    onOrderChange(order) {
      renderOrder(order);
      if (isEditing()) {
        pendingRender = true;
        return;
      }
      renderCurrentNotes(order);
    },
    persistOrder: async (order) => storage.local.set({ noteSortOrder: order }),
    onPersistError: (error) => showToast(error.message),
  });

  for (const button of buttons) {
    button.addEventListener("click", () => {
      void controller.select(button.dataset.noteSortOrder);
    });
  }

  return {
    get order() {
      return controller.order;
    },
    initialize(value) {
      controller.sync(value, { initial: true });
      renderOrder(controller.order);
    },
    sync(value) {
      return controller.sync(value);
    },
    finishEditing({ render = true } = {}) {
      if (!pendingRender) return false;
      pendingRender = false;
      if (render) renderCurrentNotes(controller.order);
      return true;
    },
  };
}

export async function initializeSidepanel({
  storage,
  onShortcutCode,
  noteSortBinding,
  setPanelContext,
  refresh,
  renderWhisperStatus,
  renderPermissionStatus,
}) {
  let shortcutCode = "AltRight";
  let noteSortOrder = "newest";
  try {
    ({ shortcutCode = "AltRight", noteSortOrder = "newest" } = await storage.local.get({
      shortcutCode,
      noteSortOrder,
    }));
  } catch {
    // 保留默认值，以便侧栏仍可完成首次渲染。
  }

  onShortcutCode(shortcutCode);
  noteSortBinding.initialize(noteSortOrder);
  await setPanelContext();
  await Promise.all([
    refresh(),
    renderWhisperStatus(),
    renderPermissionStatus(),
  ]);
}
