const DEFAULT_ZOOM = 100;
const MIN_ZOOM = 75;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

export function normalizeSidepanelZoom(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));
}

export function sidepanelZoomAfterWheel(currentZoom, deltaY) {
  const normalized = normalizeSidepanelZoom(currentZoom);
  if (deltaY === 0) return normalized;
  return normalizeSidepanelZoom(normalized + (deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}

export function createSidepanelZoomBinding({
  target,
  root,
  storage,
  showToast,
}) {
  let zoom = DEFAULT_ZOOM;
  let hasNewerPreference = false;

  function apply(value) {
    zoom = normalizeSidepanelZoom(value);
    root.style.zoom = String(zoom / 100);
    return zoom;
  }

  async function persist(value) {
    try {
      await storage.local.set({ sidepanelZoom: value });
    } catch (error) {
      showToast(error.message);
    }
  }

  target.addEventListener("wheel", (event) => {
    if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
    event.preventDefault();
    hasNewerPreference = true;
    const nextZoom = sidepanelZoomAfterWheel(zoom, event.deltaY);
    if (nextZoom === zoom) return;
    apply(nextZoom);
    showToast(`侧栏缩放 ${nextZoom}%`);
    void persist(nextZoom);
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
