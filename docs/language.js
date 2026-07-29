const LANGUAGE_STORAGE_KEY = "videoNotesLanguage";

function normalizeSiteLanguage(value) {
  const normalized = String(value ?? "").trim().replaceAll("-", "_").toLowerCase();
  if (normalized === "zh" || normalized === "zh_cn" || normalized.startsWith("zh_")) return "zh_CN";
  if (normalized === "en" || normalized.startsWith("en_")) return "en";
  return null;
}

export function chooseSiteLanguage(preference, languages = []) {
  const saved = normalizeSiteLanguage(preference);
  if (saved) return saved;
  for (const language of languages) {
    const normalized = normalizeSiteLanguage(language);
    if (normalized) return normalized;
  }
  return "en";
}

export function initializeSiteLanguageNavigation({
  document: pageDocument,
  location: pageLocation,
  navigator: pageNavigator,
  storage,
}) {
  const links = [...pageDocument.querySelectorAll("[data-language]")];
  for (const link of links) {
    link.addEventListener("click", () => {
      try {
        storage.setItem(LANGUAGE_STORAGE_KEY, link.dataset.language);
      } catch {
        // The link still navigates when storage is blocked.
      }
    });
  }

  let saved = null;
  try {
    saved = storage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // Browser language remains available when storage is blocked.
  }
  const explicit = normalizeSiteLanguage(
    new URLSearchParams(pageLocation.search ?? "").get("language"),
  );
  if (explicit) {
    saved = explicit;
    try {
      storage.setItem(LANGUAGE_STORAGE_KEY, explicit);
    } catch {
      // The explicit URL still selects the requested language.
    }
  }
  const selected = chooseSiteLanguage(saved, pageNavigator.languages ?? [pageNavigator.language]);
  const current = normalizeSiteLanguage(pageDocument.documentElement.dataset.language);
  const peer = links.find((link) => link.dataset.language === selected);
  if (selected !== current && peer) pageLocation.replace(peer.href);
}

const unavailableStorage = {
  getItem: () => null,
  setItem: () => {},
};

export function initializeSiteLanguageFromWindow(pageWindow, pageDocument) {
  let storage = unavailableStorage;
  try {
    storage = pageWindow.localStorage ?? unavailableStorage;
  } catch {
    // Browser language and regular links remain available when storage is blocked.
  }
  return initializeSiteLanguageNavigation({
    document: pageDocument,
    location: pageWindow.location,
    navigator: pageWindow.navigator,
    storage,
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initializeSiteLanguageFromWindow(window, document);
}
