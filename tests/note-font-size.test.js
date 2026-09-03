import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const noteFontSize = await import("../src/core/note-font-size.js").catch(() => ({}));
const html = await readFile(new URL("../src/sidepanel.html", import.meta.url), "utf8");
const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");
const source = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");

test("笔记字号默认 13px 并限制在 10px 到 24px", () => {
  assert.equal(noteFontSize.normalizeNoteFontSize(undefined), 13);
  assert.equal(noteFontSize.normalizeNoteFontSize("invalid"), 13);
  assert.equal(noteFontSize.normalizeNoteFontSize(8), 10);
  assert.equal(noteFontSize.normalizeNoteFontSize("16"), 16);
  assert.equal(noteFontSize.normalizeNoteFontSize(30), 24);
  assert.equal(noteFontSize.noteFontSizeAfterStep(13, -1), 12);
  assert.equal(noteFontSize.noteFontSizeAfterStep(13, 1), 14);
  assert.equal(noteFontSize.noteFontSizeAfterStep(10, -1), 10);
  assert.equal(noteFontSize.noteFontSizeAfterStep(24, 1), 24);
});

test("时间线提供弯箭头历史按钮和笔记字号按钮组", () => {
  assert.match(
    html,
    /id="undo-button"[^>]*data-i18n-title="undo"[^>]*data-i18n-aria-label="undo"[^>]*>[\s\S]*↶[\s\S]*<\/button>/,
  );
  assert.match(
    html,
    /id="redo-button"[^>]*data-i18n-title="redo"[^>]*data-i18n-aria-label="redo"[^>]*>[\s\S]*↷[\s\S]*<\/button>/,
  );
  assert.match(html, /class="note-font-size-controls"[^>]*role="group"/);
  assert.match(html, /id="note-font-size-increase"/);
  assert.match(html, /id="note-font-size-decrease"/);
  const headerStart = html.indexOf('<div class="section-row timeline-header">');
  const headerEnd = html.indexOf('<ol id="note-list"', headerStart);
  const timelineHeader = html.slice(headerStart, headerEnd);
  const controls = [
    'id="timeline-title"',
    'class="note-sort-toggle"',
    'id="undo-button"',
    'id="redo-button"',
    'id="note-font-size-increase"',
    'id="note-font-size-decrease"',
    'id="clear-button"',
    'id="export-button"',
  ];
  const positions = controls.map((control) => timelineHeader.indexOf(control));
  assert.ok(positions.every((position) => position >= 0), "时间线工具栏控件应完整存在");
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(
    css,
    /\.note-font-size-controls\s*\{[^}]*gap:\s*[^;]+;[^}]*border:\s*0;[^}]*padding:\s*0;[^}]*background:\s*transparent/s,
  );
  assert.match(
    css,
    /\.note-font-size-button\s*\{[^}]*border:\s*1px\s+solid\s+#[0-9a-f]{6};[^}]*border-radius:\s*[^;]+;[^}]*background:\s*#[0-9a-f]{6}/is,
  );
});

test("笔记正文和附带字幕共用持久化字号", () => {
  assert.match(css, /\.note-body\s*\{[^}]*font-size:\s*var\(--note-font-size,\s*13px\)/s);
  assert.match(
    css,
    /\.note-subtitle-text\s*\{[^}]*font-size:\s*max\(10px,\s*calc\(var\(--note-font-size,\s*13px\)\s*-\s*1px\)\)/s,
  );
  assert.match(source, /noteFontSize:\s*NOTE_FONT_SIZE/);
  assert.match(source, /chrome\.storage\.local\.set\(\{ noteFontSize \}\)/);
  assert.match(source, /--note-font-size/);
  assert.match(source, /changes\.noteFontSize/);
});
