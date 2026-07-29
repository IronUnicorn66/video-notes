import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseSiteLanguage,
  initializeSiteLanguageFromWindow,
  initializeSiteLanguageNavigation,
} from "../docs/language.js";

test("官网语言优先使用保存选择并回退到浏览器语言", () => {
  assert.equal(chooseSiteLanguage("zh_CN", ["en-US"]), "zh_CN");
  assert.equal(chooseSiteLanguage(null, ["zh"]), "zh_CN");
  assert.equal(chooseSiteLanguage(null, ["zh-TW", "en-US"]), "zh_CN");
  assert.equal(chooseSiteLanguage(null, ["en-GB"]), "en");
  assert.equal(chooseSiteLanguage("invalid", []), "en");
});

test("首次访问按浏览器语言跳转并记住手动选择", () => {
  const listeners = new Map();
  const links = [
    {
      dataset: { language: "zh_CN" },
      href: "https://example.com/",
      addEventListener(type, listener) { listeners.set(`zh_CN:${type}`, listener); },
    },
    {
      dataset: { language: "en" },
      href: "https://example.com/en/",
      addEventListener(type, listener) { listeners.set(`en:${type}`, listener); },
    },
  ];
  const values = new Map();
  const replacements = [];
  initializeSiteLanguageNavigation({
    document: {
      documentElement: { dataset: { language: "zh_CN" } },
      querySelectorAll: () => links,
    },
    location: { replace: (href) => replacements.push(href) },
    navigator: { languages: ["en-US"] },
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });

  assert.deepEqual(replacements, ["https://example.com/en/"]);
  listeners.get("zh_CN:click")();
  assert.equal(values.get("videoNotesLanguage"), "zh_CN");
});

test("语言切换链接的显式语言覆盖旧偏好", () => {
  const values = new Map([["videoNotesLanguage", "zh_CN"]]);
  const replacements = [];

  initializeSiteLanguageNavigation({
    document: {
      documentElement: { dataset: { language: "en" } },
      querySelectorAll: () => [],
    },
    location: {
      search: "?language=en",
      replace: (href) => replacements.push(href),
    },
    navigator: { languages: ["zh-CN"] },
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });

  assert.equal(values.get("videoNotesLanguage"), "en");
  assert.deepEqual(replacements, []);
});

test("localStorage 访问受限时仍按浏览器语言跳转", () => {
  const replacements = [];
  const document = {
    documentElement: { dataset: { language: "zh_CN" } },
    querySelectorAll: () => [{
      dataset: { language: "en" },
      href: "https://example.com/en/",
      addEventListener() {},
    }],
  };
  const pageWindow = {
    location: {
      search: "",
      replace: (href) => replacements.push(href),
    },
    navigator: { languages: ["en-US"] },
  };
  Object.defineProperty(pageWindow, "localStorage", {
    get() {
      throw new DOMException("Blocked", "SecurityError");
    },
  });

  initializeSiteLanguageFromWindow(pageWindow, document);

  assert.deepEqual(replacements, ["https://example.com/en/"]);
});
