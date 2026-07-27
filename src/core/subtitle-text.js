const IMMERSIVE_CONTAINER_SELECTOR = ".imt-captions-text";
const IMMERSIVE_CUE_SELECTOR = ".source-cue, .target-cue";
const NATIVE_SELECTORS = {
  youtube: ".ytp-caption-segment",
  bilibili: ".bpx-player-subtitle-panel-text, .bilibili-player-video-subtitle",
};

function isVisible(element) {
  return element.getClientRects().length > 0;
}

function visibleText(elements, separator) {
  const text = [];
  for (const element of elements) {
    const value = isVisible(element) ? element.textContent?.trim() : "";
    if (value && value !== text.at(-1)) text.push(value);
  }
  return text.join(separator);
}

export function readRenderedSubtitleText(root, platform) {
  const immersiveText = visibleText(
    [...root.querySelectorAll(IMMERSIVE_CONTAINER_SELECTOR)]
      .filter(isVisible)
      .flatMap((container) => container.querySelectorAll(IMMERSIVE_CUE_SELECTOR)),
    "\n",
  );
  if (immersiveText) return immersiveText;

  return visibleText(root.querySelectorAll(NATIVE_SELECTORS[platform] ?? ""), " ");
}
