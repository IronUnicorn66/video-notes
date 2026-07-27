export function inlineEditResolution({ canceled, saveSucceeded, text }) {
  const resolved = canceled === true || saveSucceeded === true;
  return {
    retryText: resolved ? null : String(text ?? ""),
    allowDeferredRefresh: resolved,
  };
}

export function inlineEditStartingText(retryText, initialText) {
  return String(retryText === undefined ? initialText ?? "" : retryText ?? "");
}

export function shouldDeferInlineEditRefresh({
  editing = false,
  pendingSaveCount = 0,
  retryCount = 0,
}) {
  return editing === true || pendingSaveCount > 0 || retryCount > 0;
}
