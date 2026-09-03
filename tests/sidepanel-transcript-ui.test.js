import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, css, source, background, content, transcriptCache] = await Promise.all([
  readFile(new URL("../src/sidepanel.html", import.meta.url), "utf8"),
  readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8"),
  readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8"),
  readFile(new URL("../src/background.js", import.meta.url), "utf8"),
  readFile(new URL("../src/content.js", import.meta.url), "utf8"),
  readFile(new URL("../src/core/full-transcript-cache.js", import.meta.url), "utf8"),
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
  assert.match(source, /formatTranscriptProgress/);
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

test("同一视频优先恢复本地字幕与译文缓存，重试时强制重新采集", () => {
  assert.match(source, /createFullTranscriptCacheLoader/);
  assert.match(transcriptCache, /repository\.getTranscriptCache/);
  assert.match(source, /cachedFullTranscriptTranslations/);
  assert.match(source, /fullTranscriptCacheWithTranslations/);
  assert.match(source, /await persistFullTranscriptTranslations\(/);
  assert.match(
    source,
    /fullTranscriptRetry\.addEventListener\("click", \(\) => \{\s*void loadFullTranscript\(\{ force: true \}\);/s,
  );
});

test("侧栏重开和切换合并档位后恢复完整字幕列表位置", () => {
  assert.match(source, /readTranscriptPosition:\s*\(\)\s*=>\s*elements\.fullTranscriptList\.scrollTop/);
  assert.match(
    source,
    /restoreTranscriptPosition:\s*\(position\)\s*=>\s*\{\s*elements\.fullTranscriptList\.scrollTop = position;/,
  );
  assert.match(
    source,
    /fullTranscriptList\.addEventListener\("scroll",[\s\S]*sidePanelViewPosition\.scheduleSave\(\)/,
  );
  assert.match(source, /sidePanelViewPosition\.prepareTranscriptGroupChange\(\)/);
  assert.match(source, /renderFullTranscript\(\);\s*void sidePanelViewPosition\.restoreTranscript\(\);/);
});

test("完整字幕工具栏将分组和操作控件保持在同一行", () => {
  assert.match(css, /\.full-transcript-list\s*\{[^}]*max-height:/s);
  assert.match(css, /\.full-transcript-toolbar\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.full-transcript-toolbar\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /\.full-transcript-toolbar\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.full-transcript-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.full-transcript-action\s*\{[^}]*min-width:\s*50px/s);
  assert.match(css, /\.full-transcript-action\s*\{[^}]*padding:\s*6px 8px/s);
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
  assert.match(
    css,
    /\.full-transcript-panel > summary > span\s*\{[^}]*white-space:\s*nowrap/s,
  );
  assert.match(
    css,
    /\.full-transcript-panel > summary small\s*\{[^}]*flex:\s*1 1 0/s,
  );
  assert.match(
    css,
    /\.full-transcript-panel > summary small\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s,
  );
  assert.match(css, /\.full-transcript-time/);
});

test("完整字幕工具栏提供同高对齐的字号减小和增大按钮", () => {
  assert.match(html, /class="full-transcript-font-size-controls"[^>]*role="group"/);
  assert.match(html, /id="full-transcript-font-size-decrease"/);
  assert.match(html, /id="full-transcript-font-size-increase"/);
  assert.match(html, /data-i18n-aria-label="decreaseFullTranscriptFontSize"/);
  assert.match(html, /data-i18n-aria-label="increaseFullTranscriptFontSize"/);
  assert.match(
    html,
    /id="full-transcript-font-size-increase"[\s\S]*id="full-transcript-font-size-decrease"/,
  );
  assert.match(css, /\.full-transcript-font-size-controls\s*\{[^}]*display:\s*flex/s);
  assert.match(
    css,
    /\.full-transcript-font-size-button\s*\{[^}]*width:\s*34px[^}]*height:\s*34px/s,
  );
  assert.match(
    css,
    /\.full-transcript-text[^}]*font-size:\s*var\(--full-transcript-font-size,\s*12px\)/s,
  );
  assert.match(
    css,
    /\.full-transcript-translation[^}]*font-size:\s*var\(--full-transcript-font-size,\s*12px\)/s,
  );
  assert.match(source, /fullTranscriptFontSize:\s*TRANSCRIPT_FONT_SIZE/);
  assert.match(source, /chrome\.storage\.local\.set\(\{ fullTranscriptFontSize \}\)/);
  assert.match(source, /--full-transcript-font-size/);
});

test("译文完成后在翻译和重试之间显示原文与译文选项", () => {
  assert.match(
    html,
    /id="full-transcript-translate"[\s\S]*id="full-transcript-display-options"[\s\S]*id="full-transcript-retry"/,
  );
  assert.match(html, /id="full-transcript-display-options"[^>]*role="group"[^>]*hidden/);
  assert.match(html, /id="full-transcript-show-original"[^>]*type="checkbox"[^>]*checked/);
  assert.match(html, /id="full-transcript-show-translation"[^>]*type="checkbox"[^>]*checked/);
  assert.match(html, /data-i18n="fullTranscriptOriginal">原文/);
  assert.match(html, /data-i18n="fullTranscriptTranslation">译文/);
  assert.match(html, /data-i18n-aria-label="fullTranscriptDisplayOptions"/);
  assert.match(css, /\.full-transcript-display-options\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.full-transcript-display-options\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.full-transcript-display-option\s*\{[^}]*font-size:\s*11px/s);
  assert.match(source, /createFullTranscriptDisplayBinding/);
  assert.match(source, /transcriptGroupsFullyTranslated/);
  assert.match(source, /fullTranscriptShowOriginal:\s*true/);
  assert.match(source, /fullTranscriptShowTranslation:\s*true/);
  assert.match(source, /if \(displayPreference\.showOriginal\)/);
  assert.match(source, /if \(cue\.translation && displayPreference\.showTranslation\)/);
});

test("重试左侧的定位按钮直接跳到播放器当前字幕", () => {
  assert.match(
    html,
    /id="full-transcript-display-options"[\s\S]*id="full-transcript-locate"[\s\S]*id="full-transcript-retry"/,
  );
  assert.match(html, /id="full-transcript-locate"[\s\S]*data-i18n="fullTranscriptLocate"/);
  assert.match(html, /id="full-transcript-locate"[\s\S]*data-i18n-title="fullTranscriptLocateTitle"/);
  assert.match(html, /id="full-transcript-locate"[\s\S]*data-i18n-aria-label="fullTranscriptLocateTitle"/);
  assert.match(source, /type: "GET_VIDEO_POSITION"/);
  assert.match(source, /centeredTranscriptScrollTop\(\{/);
  assert.match(source, /listBounds\.height\s*\/\s*elements\.fullTranscriptList\.clientHeight/);
  assert.doesNotMatch(source, /fullTranscriptList\.scrollTo\(\{[\s\S]*behavior: "smooth"/);
  assert.match(source, /full-transcript-cue-located/);
  assert.match(css, /\.full-transcript-cue-located\s*\{/);
  assert.match(background, /case "GET_VIDEO_POSITION"/);
  assert.match(content, /case "GET_VIDEO_POSITION"/);
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
  assert.deepEqual(
    [...html.matchAll(/type="radio"[^>]*name="full-transcript-group-size"[^>]*data-full-transcript-group-size[^>]*value="(\d+)"/g)]
      .map((match) => Number(match[1])),
    [5, 10, 20],
  );
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
    /if \(generation === fullTranscriptGeneration\) \{\s*fullTranscriptLoading = false;\s*syncFullTranscriptTranslateButton\(\);\s*syncFullTranscriptLocateButton\(\);[\s\S]*\}/s,
  );
});

test("切换视频、重新加载和关闭侧栏会中断本地翻译并销毁文档会话", () => {
  assert.match(
    source,
    /function cancelFullTranscriptTranslation\(\) \{[\s\S]*fullTranscriptTranslationController\?\.abort\(\);[\s\S]*destroyBrowserTranslationSession\(\);[\s\S]*\}/,
  );
  assert.match(source, /async function loadFullTranscript\([^)]*\) \{[\s\S]*cancelFullTranscriptTranslation\(\);/);
  assert.match(source, /window\.addEventListener\("pagehide", \(\) => \{[\s\S]*cancelFullTranscriptTranslation\(\);/);
  assert.match(source, /session\.destroy\(\)/);
  assert.match(source, /untranslatedTranscriptSegments\(groups\)/);
  assert.match(source, /fullTranscriptTranslations\.set\(id, translation\)/);
  assert.match(source, /button\.disabled = fullTranscriptTranslationRunning/);
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

test("当前完整字幕和译文同步给所有记笔记入口", () => {
  assert.match(source, /type: "SYNC_LOCAL_TRANSCRIPT_NOTE_SOURCE"/);
  assert.match(source, /currentFullTranscriptGroups\(\)\.map/);
  assert.match(source, /translation: group\.translation \?\? ""/);
  assert.match(source, /fullTranscriptTranslations\.set\(id, translation\);\s*syncLocalTranscriptNoteSource\(\)/);
  assert.match(background, /case "SYNC_LOCAL_TRANSCRIPT_NOTE_SOURCE"/);
  assert.match(content, /case "SYNC_LOCAL_TRANSCRIPT_NOTE_SOURCE"/);
  assert.match(content, /new BilibiliTranscriptSource\(\)/);
  assert.match(content, /await loadBilibiliTranscriptNoteSource\(context\)/);
  assert.match(content, /localTranscriptNoteContext\(\{/);
  assert.match(content, /preferredNoteSubtitleContext\(\{/);
  assert.match(content, /renderedText: subtitleCapture\.before\(seconds\)/);
  assert.match(background, /subtitleTranslation: String\(snapshot\.subtitleTranslation \?\? ""\)\.trim\(\)/);
  assert.match(source, /type: "BEGIN_TYPED_NOTE",\s*localTranscriptNoteSource: currentLocalTranscriptNoteSource\(\)/);
  assert.match(source, /type: "VOICE_START_REQUEST",\s*localTranscriptNoteSource: currentLocalTranscriptNoteSource\(\)/);
  assert.match(background, /type: "PREPARE_MARKER",[\s\S]*localTranscriptNoteSource/);
  assert.match(content, /source: context\.platform === "bilibili" \? bilibiliSource : localTranscriptNoteSource/);
  assert.match(content, /preferredSource: context\.platform === "youtube" \? preferredSource : null/);
});

test("笔记卡片将本地字幕原文与译文分块显示", () => {
  assert.match(source, /subtitleState\.translation/);
  assert.match(source, /t\("fullTranscriptOriginal"\)/);
  assert.match(source, /t\("fullTranscriptTranslation"\)/);
  assert.match(css, /\.note-subtitle-part \+ \.note-subtitle-part\s*\{/);
  assert.match(css, /\.note-subtitle-translation\s*\{/);
});
