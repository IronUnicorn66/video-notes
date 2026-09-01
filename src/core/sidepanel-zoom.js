const DEFAULT_ZOOM = 100;
const MIN_ZOOM = 75;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

export function normalizeSidepanelZoom(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));
}

export function sidepanelZoomAfterStep(currentZoom, direction) {
  const normalized = normalizeSidepanelZoom(currentZoom);
  if (direction === 0) return normalized;
  return normalizeSidepanelZoom(normalized + (direction > 0 ? ZOOM_STEP : -ZOOM_STEP));
}

export function createSidepanelZoomBinding({
  target,
  root,
  increaseButton,
  decreaseButton,
  storage,
  showToast,
}) {
  let zoom = DEFAULT_ZOOM;
  let hasNewerPreference = false;

  function apply(value) {
    zoom = normalizeSidepanelZoom(value);
    root.style.zoom = String(zoom / 100);
    increaseButton.disabled = zoom >= MAX_ZOOM;
    decreaseButton.disabled = zoom <= MIN_ZOOM;
    return zoom;
  }

  async function persist(value) {
    try {
      await storage.local.set({ sidepanelZoom: value });
    } catch (error) {
      showToast(error.message);
    }
  }

  function step(direction) {
    hasNewerPreference = true;
    const nextZoom = sidepanelZoomAfterStep(zoom, direction);
    if (nextZoom === zoom) return;
    apply(nextZoom);
    showToast(`侧栏缩放 ${nextZoom}%`);
    void persist(nextZoom);
  }

  increaseButton.addEventListener("click", () => step(1));
  decreaseButton.addEventListener("click", () => step(-1));

  target.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
  }, { passive: false });

  return {
    get zoom() {
      return zoom;
    },
    initialize(value) {
      if (hasNewerPreference) return zoom;
      return apply(value);
    },
  };
}
