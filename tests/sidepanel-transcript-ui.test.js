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

test("侧栏在权限设置中提供翻译 API，并在完整字幕工具栏提供单选合并条数", () => {
  assert.match(html, /id="full-transcript-translation-base-url"[^>]*type="url"/);
  assert.match(html, /id="full-transcript-translation-api-key"[^>]*type="password"/);
  assert.match(html, /id="full-transcript-translation-model"[^>]*type="text"/);
  assert.match(html, /id="full-transcript-translation-save"/);
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

test("侧栏翻译只在显式操作后按 API 主机授权并保留原文与译文", () => {
  assert.match(source, /normalizeFullTranscriptTranslationConfig/);
  assert.match(source, /translateTranscriptBatch/);
  assert.match(source, /requestTranslationHostPermission/);
  assert.match(source, /fullTranscriptTranslation/);
  assert.match(source, /full-transcript-translation/);
});

test("完整字幕加载结束后会重新启用翻译按钮", () => {
  assert.match(
    source,
    /if \(generation === fullTranscriptGeneration\) \{\s*fullTranscriptLoading = false;\s*syncFullTranscriptTranslateButton\(\);\s*\}/s,
  );
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
