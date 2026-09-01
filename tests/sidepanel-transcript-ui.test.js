import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, css, source] = await Promise.all([
  readFile(new URL("../src/sidepanel.html", import.meta.url), "utf8"),
  readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8"),
  readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8"),
]);

test("侧栏提供可折叠的完整字幕、翻译和重试入口", () => {
  assert.match(html, /<details id="full-transcript-panel"[^>]*hidden/);
  assert.doesNotMatch(html, /full-transcript-search/);
  assert.doesNotMatch(html, /full-transcript-display-toggle/);
  assert.doesNotMatch(html, /fullTranscriptShowIndividual/);
  assert.match(html, /id="full-transcript-retry"/);
  assert.match(html, /id="full-transcript-translate"/);
  assert.match(html, /id="full-transcript-list"/);
  assert.match(html, /id="full-transcript-empty"/);
});

test("完整字幕在 YouTube 上自动读取并按标签页发送跳转", () => {
  assert.match(source, /type: "GET_FULL_YOUTUBE_TRANSCRIPT"/);
  assert.match(source, /type: "SEEK_VIDEO"/);
  assert.match(source, /activeContext\.platform !== "youtube"/);
  assert.match(source, /transcriptCoverage/);
  assert.match(source, /groupTranscriptCues/);
  assert.doesNotMatch(source, /fullTranscriptGrouped/);
  assert.match(source, /formatTranscriptTimeRange/);
  assert.match(source, /time\.dataset\.sessionId/);
  assert.match(source, /time\.dataset\.videoId/);
  assert.match(source, /sessionId: button\.dataset\.sessionId/);
  assert.match(source, /videoId: button\.dataset\.videoId/);
  assert.match(
    source,
    /\["ACTIVE_CONTEXT_CHANGED", "TAB_LOAD_COMPLETE"\][\s\S]*resetFullTranscript\(\)/,
  );
});

test("完整字幕工具栏将分组和操作控件保持在同一行", () => {
  assert.match(css, /\.full-transcript-list\s*\{[^}]*max-height:/s);
  assert.match(css, /\.full-transcript-toolbar\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.full-transcript-toolbar\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /\.full-transcript-toolbar\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.full-transcript-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.full-transcript-action\s*\{[^}]*min-width:\s*58px/s);
  assert.match(css, /\.full-transcript-action\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(html, /class="full-transcript-actions" role="group"/);
  assert.match(html, /class="full-transcript-group-picker"\s+role="radiogroup"/);
  assert.match(html, /class="full-transcript-group-label"/);
  assert.match(html, /data-i18n="fullTranscriptGroupSize">合并条数/);
  assert.doesNotMatch(html, /<fieldset[^>]*full-transcript-group-picker/);
  assert.match(
    css,
    /\.full-transcript-panel > summary small\s*\{[^}]*white-space:\s*normal/s,
  );
  assert.match(css, /\.full-transcript-time/);
});

test("侧栏自动显示字幕语言并只提供五种翻译目标语言", () => {
  assert.match(html, /id="browser-translation-detected-source"/);
  assert.match(html, /id="browser-translation-language-pack-select"/);
  assert.deepEqual(
    [...html.matchAll(/<option value="(zh-Hans|en|ja|ko|es)"/g)].map((match) => match[1]),
    ["zh-Hans", "en", "ja", "ko", "es"],
  );
  assert.doesNotMatch(html, /<option value="fr"/);
  assert.match(html, /id="browser-translation-language-pack-progress"[^>]*hidden/);
  assert.match(html, /id="browser-translation-language-pack-status"[^>]*role="status"/);
  assert.match(html, /id="browser-translation-language-pack-action"[^>]*hidden/);
  assert.doesNotMatch(html, /OpenAI|API Base URL|API Key|full-transcript-translation-provider/);
  assert.match(html, /class="full-transcript-group-picker"/);
  for (const value of [5, 10, 20, 30]) {
    assert.match(
      html,
      new RegExp(`type="radio"[^>]*name="full-transcript-group-size"[^>]*data-full-transcript-group-size[^>]*value="${value}"`),
    );
  }
  assert.match(html, /data-full-transcript-group-size value="5" checked/);
  assert.doesNotMatch(html, /id="full-transcript-group-size"/);
  assert.match(source, /fullTranscriptGroupButtons/);
  assert.doesNotMatch(source, /fullTranscriptSearch/);
  assert.match(css, /\.full-transcript-group-picker\s*\{/);
  assert.match(css, /label:has\(input:checked\)/);
});

test("侧栏只创建浏览器本地会话并支持提前下载语言包", () => {
  assert.match(source, /createBrowserTranscriptTranslator/);
  assert.match(source, /prepareBrowserTranslationLanguagePack/);
  assert.match(source, /translateBrowserTranscriptCues/);
  assert.match(source, /browserTranscriptTranslationAvailability/);
  assert.match(source, /targetLanguage,/);
  assert.match(source, /fullTranscriptLanguagePackTarget/);
  assert.match(source, /clearFullTranscriptTranslations\(\)/);
  assert.doesNotMatch(source, /fullTranscriptLanguagePackSource:\s*["']/);
  assert.doesNotMatch(source, /translateTranscriptBatch|requestTranslationHostPermission|apiKey|chat\/completions/);
});

test("完整字幕加载结束后会重新启用翻译按钮", () => {
  assert.match(
    source,
    /if \(generation === fullTranscriptGeneration\) \{\s*fullTranscriptLoading = false;\s*syncFullTranscriptTranslateButton\(\);\s*\}/s,
  );
});

test("切换视频、重试和关闭侧栏会中断本地翻译并销毁文档会话", () => {
  assert.match(
    source,
    /function cancelFullTranscriptTranslation\(\) \{[\s\S]*fullTranscriptTranslationController\?\.abort\(\);[\s\S]*destroyBrowserTranslationSession\(\);[\s\S]*\}/,
  );
  assert.match(source, /async function loadFullTranscript\(\) \{[\s\S]*cancelFullTranscriptTranslation\(\);/);
  assert.match(source, /window\.addEventListener\("pagehide", \(\) => \{[\s\S]*cancelFullTranscriptTranslation\(\);/);
  assert.match(source, /session\.destroy\(\)/);
  assert.match(source, /untranslatedTranscriptCues\(transcript\.cues\)/);
});

test("完整字幕将时间范围置于正文上方以避免两列留白", () => {
  assert.match(
    css,
    /\.full-transcript-cue\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
  );
  assert.match(
    css,
    /\.full-transcript-time\s*\{[^}]*justify-self:\s*start/s,
  );
});
