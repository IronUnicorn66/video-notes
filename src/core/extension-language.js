import { normalizeLanguage, resolveLanguage, translate } from "./i18n.js";

export const INTERFACE_LANGUAGE_KEY = "interfaceLanguage";

export async function readInterfaceLanguage(storageLocal, uiLanguage) {
  const values = await storageLocal.get(INTERFACE_LANGUAGE_KEY);
  return resolveLanguage(values[INTERFACE_LANGUAGE_KEY], uiLanguage);
}

export async function writeInterfaceLanguage(storageLocal, language) {
  const normalized = normalizeLanguage(language);
  if (!normalized) throw new Error(`不支持的界面语言：${language}`);
  await storageLocal.set({ [INTERFACE_LANGUAGE_KEY]: normalized });
}

export function localizeDocument(root, language) {
  root.documentElement?.setAttribute("lang", language === "en" ? "en" : "zh-CN");
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = translate(language, node.dataset.i18n, {
      count: node.dataset.i18nCount,
    });
  }
  for (const node of root.querySelectorAll("[data-i18n-placeholder]")) {
    node.placeholder = translate(language, node.dataset.i18nPlaceholder);
  }
  for (const node of root.querySelectorAll("[data-i18n-aria-label]")) {
    node.setAttribute("aria-label", translate(language, node.dataset.i18nAriaLabel));
  }
  for (const node of root.querySelectorAll("[data-i18n-title]")) {
    node.setAttribute("title", translate(language, node.dataset.i18nTitle));
  }
  for (const node of root.querySelectorAll("[data-i18n-alt]")) {
    node.setAttribute("alt", translate(language, node.dataset.i18nAlt));
  }
}
