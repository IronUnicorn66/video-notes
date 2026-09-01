import assert from "node:assert/strict";
import test from "node:test";

import {
  localizeRuntimeMessage,
  normalizeLanguage,
  resolveLanguage,
  translate,
} from "../src/core/i18n.js";
import {
  readInterfaceLanguage,
  writeInterfaceLanguage,
} from "../src/core/extension-language.js";

test("界面语言选择支持浏览器默认与显式偏好", () => {
  assert.equal(normalizeLanguage("zh"), "zh_CN");
  assert.equal(normalizeLanguage("zh-CN"), "zh_CN");
  assert.equal(normalizeLanguage("en-US"), "en");
  assert.equal(normalizeLanguage("invalid"), null);
  assert.equal(resolveLanguage(undefined, "zh-TW"), "zh_CN");
  assert.equal(resolveLanguage(undefined, "en-US"), "en");
  assert.equal(resolveLanguage("en", "zh-CN"), "en");
  assert.equal(resolveLanguage("invalid", "zh-CN"), "zh_CN");
});

test("英文消息替换变量并暴露缺失键", () => {
  assert.equal(translate("en", "exportComplete", { count: 3 }), "Exported 3 notes to ZIP");
  assert.equal(translate("en", "missingKey"), "missingKey");
});

test("英文界面翻译后台与核心模块返回的用户提示", () => {
  assert.equal(
    localizeRuntimeMessage("en", "请先在侧栏的权限设置中授权麦克风"),
    "Authorize microphone access in the side panel settings first",
  );
  assert.equal(
    localizeRuntimeMessage("en", "模型下载失败（HTTP 503）"),
    "Model download failed (HTTP 503)",
  );
  assert.equal(
    localizeRuntimeMessage("en", "转写失败：网络已断开"),
    "Transcription failed: The network connection was lost",
  );
  assert.equal(
    localizeRuntimeMessage("en", "请在新页面完成麦克风授权"),
    "Complete microphone authorization in the newly opened page",
  );
  assert.equal(
    localizeRuntimeMessage("en", "背景音未联动静音"),
    "Background audio could not be muted automatically",
  );
  assert.equal(
    localizeRuntimeMessage("en", "转写失败：原始录音已丢失"),
    "Transcription failed: The original recording is missing",
  );
  assert.equal(
    localizeRuntimeMessage("en", "模型分块长度异常：期望 100，收到 50"),
    "Invalid model chunk length: expected 100, received 50",
  );
  assert.equal(
    localizeRuntimeMessage("en", "内置模型模型 SHA-256 校验失败"),
    "Bundled model: Model SHA-256 verification failed",
  );
  assert.equal(
    localizeRuntimeMessage("en", "当前浏览器不支持本地翻译"),
    "This browser does not support local translation",
  );
  assert.equal(
    localizeRuntimeMessage("en", "本地翻译不可用：language pack failed"),
    "Local translation is unavailable: language pack failed",
  );
  assert.equal(
    translate("en", "fullTranscriptLanguagePackReady", { size: 200 }),
    "Downloaded · about 200 MiB",
  );
  assert.equal(localizeRuntimeMessage("zh_CN", "录音启动失败"), "录音启动失败");
  assert.equal(localizeRuntimeMessage("en", "unmapped browser error"), "unmapped browser error");
});

test("扩展语言偏好按键读取并写回本地存储", async () => {
  const values = { interfaceLanguage: "en" };
  const storage = {
    async get(keys) {
      if (typeof keys === "string") {
        return Object.hasOwn(values, keys) ? { [keys]: values[keys] } : {};
      }
      return {};
    },
    async set(changes) {
      Object.assign(values, changes);
    },
  };

  assert.equal(await readInterfaceLanguage(storage, "zh-CN"), "en");
  await writeInterfaceLanguage(storage, "zh_CN");
  assert.equal(values.interfaceLanguage, "zh_CN");
  assert.equal(await readInterfaceLanguage(storage, "en-GB"), "zh_CN");
  await assert.rejects(() => writeInterfaceLanguage(storage, "fr"), /不支持的界面语言/);
});
