export function computeScreenshotCrop(rect, viewport, image, maxEdge = 1600) {
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.x + rect.width);
  const bottom = Math.min(viewport.height, rect.y + rect.height);

  const sx = Math.max(0, Math.floor(left * scaleX));
  const sy = Math.max(0, Math.floor(top * scaleY));
  const sw = Math.max(1, Math.ceil(right * scaleX) - sx);
  const sh = Math.max(1, Math.ceil(bottom * scaleY) - sy);
  const ratio = Math.min(1, maxEdge / Math.max(sw, sh));

  return {
    sx,
    sy,
    sw,
    sh,
    outputWidth: Math.max(1, Math.round(sw * ratio)),
    outputHeight: Math.max(1, Math.round(sh * ratio)),
  };
}
