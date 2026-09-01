const DEFAULT_FULL_TRANSCRIPT_DISPLAY_PREFERENCE = Object.freeze({
  showOriginal: true,
  showTranslation: true,
});

export function normalizeFullTranscriptDisplayPreference(value = {}) {
  const preference = {
    showOriginal: value.showOriginal !== false,
    showTranslation: value.showTranslation !== false,
  };
  return preference.showOriginal || preference.showTranslation
    ? preference
    : { ...DEFAULT_FULL_TRANSCRIPT_DISPLAY_PREFERENCE };
}

export function fullTranscriptDisplayPreferenceAfterChange(
  currentPreference,
  field,
  checked,
) {
  const current = normalizeFullTranscriptDisplayPreference(currentPreference);
  if (!["showOriginal", "showTranslation"].includes(field)) return current;
  const next = { ...current, [field]: checked === true };
  return next.showOriginal || next.showTranslation ? next : current;
}

export function transcriptGroupsFullyTranslated(groups) {
  return groups.length > 0
    && groups.every((group) => String(group.translation ?? "").trim());
}

export function createFullTranscriptDisplayBinding({
  group,
  original,
  translation,
  storage,
  render,
  onError = () => {},
}) {
  let available = false;
  let current = { ...DEFAULT_FULL_TRANSCRIPT_DISPLAY_PREFERENCE };

  function syncControls() {
    group.hidden = !available;
    original.checked = current.showOriginal;
    translation.checked = current.showTranslation;
    original.disabled = !available || (current.showOriginal && !current.showTranslation);
    translation.disabled = !available || (current.showTranslation && !current.showOriginal);
  }

  async function change(field, checked) {
    if (!available) {
      syncControls();
      return false;
    }
    const previous = current;
    const next = fullTranscriptDisplayPreferenceAfterChange(previous, field, checked);
    if (
      next.showOriginal === previous.showOriginal
      && next.showTranslation === previous.showTranslation
    ) {
      syncControls();
      return false;
    }
    current = next;
    syncControls();
    render();
    try {
      await storage.set({
        fullTranscriptShowOriginal: current.showOriginal,
        fullTranscriptShowTranslation: current.showTranslation,
      });
      return true;
    } catch (error) {
      current = previous;
      syncControls();
      render();
      onError(error);
      return false;
    }
  }

  original.addEventListener("change", () => {
    void change("showOriginal", original.checked);
  });
  translation.addEventListener("change", () => {
    void change("showTranslation", translation.checked);
  });
  syncControls();

  return {
    change,
    effectivePreference() {
      return available
        ? { ...current }
        : { ...DEFAULT_FULL_TRANSCRIPT_DISPLAY_PREFERENCE };
    },
    preference() {
      return { ...current };
    },
    setAvailable(value) {
      available = value === true;
      syncControls();
    },
    sync(value) {
      current = normalizeFullTranscriptDisplayPreference(value);
      syncControls();
    },
  };
}
