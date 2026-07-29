import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import { localizeDocument } from "../src/core/extension-language.js";

const execute = promisify(execFile);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("英文 Manifest 语言包提供产品元数据", async () => {
  const messages = JSON.parse(await read("_locales/en/messages.json"));

  assert.equal(messages.extensionName.message, "Video Notes");
  assert.match(messages.extensionDescription.message, /YouTube and Bilibili/);
  assert.equal(messages.actionTitle.message, "Open Video Notes");
});

test("文档本地化更新正文、属性和页面语言", () => {
  const nodes = {
    text: { dataset: { i18n: "quickNote" }, textContent: "" },
    placeholder: { dataset: { i18nPlaceholder: "notePlaceholder" }, placeholder: "" },
    aria: {
      dataset: { i18nAriaLabel: "languageSelector" },
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    },
    title: {
      dataset: { i18nTitle: "oldestFirst" },
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    },
  };
  const root = {
    documentElement: {
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    },
    querySelectorAll(selector) {
      return {
        "[data-i18n]": [nodes.text],
        "[data-i18n-placeholder]": [nodes.placeholder],
        "[data-i18n-aria-label]": [nodes.aria],
        "[data-i18n-title]": [nodes.title],
      }[selector] ?? [];
    },
  };

  localizeDocument(root, "en");

  assert.equal(root.documentElement.attributes.lang, "en");
  assert.equal(nodes.text.textContent, "Quick note");
  assert.match(nodes.placeholder.placeholder, /pause the video/);
  assert.equal(nodes.aria.attributes["aria-label"], "Interface language");
  assert.equal(nodes.title.attributes.title, "Oldest notes first");
});

test("发布构建包含双语资源与侧栏切换入口", async () => {
  await execute(process.execPath, ["scripts/build-extension.mjs"], {
    cwd: new URL("../", import.meta.url),
  });

  await access(new URL("../dist/_locales/zh_CN/messages.json", import.meta.url));
  await access(new URL("../dist/_locales/en/messages.json", import.meta.url));
  const [sidepanel, permissionPage] = await Promise.all([
    read("dist/sidepanel.html"),
    read("dist/microphone-permission.html"),
  ]);
  assert.match(sidepanel, /data-interface-language="zh_CN"/);
  assert.match(sidepanel, /data-interface-language="en"/);
  assert.match(sidepanel, /data-i18n="quickNote"/);
  assert.match(permissionPage, /data-i18n="microphonePermissionTitle"/);
});

test("麦克风授权页响应已保存的界面语言变化", async () => {
  const source = await read("src/microphone-permission.js");

  assert.match(source, /chrome\.storage\.onChanged\.addListener/);
  assert.match(source, /INTERFACE_LANGUAGE_KEY/);
  assert.match(source, /location\.reload\(\)/);
});
