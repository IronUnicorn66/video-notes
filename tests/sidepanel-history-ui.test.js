import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../src/sidepanel.html", import.meta.url), "utf8");
const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");
const source = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");

function occurrences(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test("历史工具栏提供撤销、反撤销和紧邻导出的清空按钮", () => {
  assert.equal(occurrences(html, /id="undo-button"/g), 1);
  assert.equal(occurrences(html, /id="redo-button"/g), 1);
  assert.equal(occurrences(html, /id="clear-button"/g), 1);
  assert.match(
    html,
    /id="clear-button"[^>]*>清空<\/button>\s*<button id="export-button"/,
  );
});

test("删除和清空共用一个标题及描述均有关联的确认框", () => {
  assert.equal(occurrences(html, /id="history-confirm-dialog"/g), 1);
  assert.match(
    html,
    /<dialog id="history-confirm-dialog"[^>]*aria-labelledby="history-confirm-title"[^>]*aria-describedby="history-confirm-description"/,
  );
  assert.match(html, /<form method="dialog" class="confirm-dialog-card">/);
  assert.match(html, /<h2 id="history-confirm-title"><\/h2>/);
  assert.match(html, /<p id="history-confirm-description"><\/p>/);
  assert.match(html, /<button value="cancel" class="secondary-button">取消<\/button>/);
  assert.match(
    html,
    /<button id="history-confirm-button" value="confirm" class="danger-button">确认<\/button>/,
  );
});

test("笔记卡片把删除放在编辑旁并先通过统一确认框", () => {
  const renderStart = source.indexOf("function renderNotes(");
  const renderEnd = source.indexOf("\nasync function refresh(", renderStart);
  const renderSource = source.slice(renderStart, renderEnd);
  const confirmation = renderSource.indexOf("confirmHistoryAction(");
  const deletion = renderSource.indexOf('type: "DELETE_NOTE"');

  assert.match(renderSource, /deleteButton\.textContent = "删除"/);
  assert.match(renderSource, /actions\.append\(kind, edit, deleteButton\)/);
  assert.ok(confirmation >= 0, "笔记删除应调用统一确认框");
  assert.ok(deletion > confirmation, "DELETE_NOTE 只能出现在确认回调之后");
  assert.match(
    renderSource.slice(confirmation, deletion),
    /formatTimestamp\(note\.seconds\)/,
  );
});

test("取消或关闭确认框不执行待定操作", () => {
  const confirmStart = source.indexOf("function confirmHistoryAction(");
  const confirmEnd = source.indexOf("\nfunction ", confirmStart + 1);
  const confirmSource = source.slice(confirmStart, confirmEnd);
  const closeStart = source.indexOf('elements.historyConfirmDialog.addEventListener("close"');
  const closeEnd = source.indexOf("\n});", closeStart) + 4;
  const closeSource = source.slice(closeStart, closeEnd);

  assert.match(confirmSource, /pendingHistoryAction = action/);
  assert.match(confirmSource, /showModal\(\)/);
  assert.match(closeSource, /pendingHistoryAction = null/);
  assert.match(closeSource, /returnValue !== "confirm"/);
  assert.match(closeSource, /if \(!action\) return/);
  assert.ok(
    closeSource.indexOf('returnValue !== "confirm"') < closeSource.indexOf("void action()"),
    "取消判断应先于执行待定操作",
  );
});

test("活动状态驱动历史控件且所有会话历史请求携带侧栏标签页", () => {
  assert.match(source, /canUndo = response\.history\.canUndo/);
  assert.match(source, /canRedo = response\.history\.canRedo/);
  assert.match(source, /historyControlState\(\{/);
  assert.match(
    source,
    /blocked: Boolean\(\s*currentDraft\s*\|\| draftPromise\s*\|\| recording\s*\|\| voiceStarting\s*\|\| inlineEditController\.blocked[\s\S]{0,120}\)/,
  );
  assert.match(source, /\|\| typedDraftSaving/);
  assert.match(source, /\|\| voiceStopping/);
  assert.match(source, /pending: historyOperationController\.pending/);
  assert.match(
    source,
    /description: `将清空 \$\{savedNoteCount\(\)\} 条已保存标记。可通过撤销恢复。`/,
  );

  for (const type of [
    "CLEAR_SESSION_NOTES",
    "UNDO_NOTE_ACTION",
    "REDO_NOTE_ACTION",
  ]) {
    assert.match(
      source,
      new RegExp(`type: "${type}",[\\s\\S]{0,160}tabId: sidePanelRefresh\\.tabId`),
    );
  }
});

test("历史请求忙碌时同步禁用控件且快捷键只拦截可执行操作", () => {
  assert.match(source, /historyOperationController\.pending/);
  assert.match(source, /const operation = historyOperationController\.run\(/);
  assert.match(source, /const succeeded = await operation/);
  assert.match(source, /syncHistoryControls\(\)/);
  assert.match(source, /deleteButton\.disabled = controls\.deleteDisabled/);
  assert.match(source, /elements\.clearButton\.disabled = controls\.clearDisabled/);
  assert.match(source, /elements\.undoButton\.disabled = controls\.undoDisabled/);
  assert.match(source, /elements\.redoButton\.disabled = controls\.redoDisabled/);

  const shortcutStart = source.indexOf('document.addEventListener("keydown"');
  const shortcutEnd = source.indexOf("\n});", shortcutStart) + 4;
  const shortcutSource = source.slice(shortcutStart, shortcutEnd);
  assert.match(shortcutSource, /const operation = historyShortcut\(event\)/);
  assert.ok(
    shortcutSource.indexOf("canRunHistoryAction(operation)")
      < shortcutSource.indexOf("event.preventDefault()"),
    "可执行性检查应先于 preventDefault",
  );
});

test("窄侧栏操作区可换行且危险操作使用克制红色样式", () => {
  assert.match(css, /\.timeline-actions\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /\.danger-button[\s\S]*border[^;]*#[0-9a-f]{6}/i);
  assert.match(css, /\.note-delete-button[\s\S]*color[^;]*#[0-9a-f]{6}/i);
  assert.match(css, /min-width:\s*320px/);
});
