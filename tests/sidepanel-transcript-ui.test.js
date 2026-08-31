import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, css, source] = await Promise.all([
  readFile(new URL("../src/sidepanel.html", import.meta.url), "utf8"),
  readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8"),
  readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8"),
]);

test("侧栏提供可折叠的完整字幕、搜索和重试入口", () => {
  assert.match(html, /<details id="full-transcript-panel"[^>]*hidden/);
  assert.match(html, /id="full-transcript-search"[^>]*type="search"/);
  assert.match(html, /id="full-transcript-display-toggle"/);
  assert.match(html, /data-i18n="fullTranscriptShowIndividual"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /id="full-transcript-retry"/);
  assert.match(html, /id="full-transcript-list"/);
  assert.match(html, /id="full-transcript-empty"/);
});

test("完整字幕在 YouTube 上自动读取并按标签页发送跳转", () => {
  assert.match(source, /type: "GET_FULL_YOUTUBE_TRANSCRIPT"/);
  assert.match(source, /type: "SEEK_VIDEO"/);
  assert.match(source, /activeContext\.platform !== "youtube"/);
  assert.match(source, /transcriptCoverage/);
  assert.match(source, /transcriptDisplayCues/);
  assert.match(source, /fullTranscriptGrouped = true/);
  assert.match(source, /formatTranscriptTimeRange/);
});

test("完整字幕列表适合长课程滚动和窄侧栏", () => {
  assert.match(css, /\.full-transcript-list\s*\{[^}]*max-height:/s);
  assert.match(css, /\.full-transcript-search\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.full-transcript-display-toggle/);
  assert.match(
    css,
    /\.full-transcript-panel > summary small\s*\{[^}]*white-space:\s*normal/s,
  );
  assert.match(css, /\.full-transcript-time/);
});
