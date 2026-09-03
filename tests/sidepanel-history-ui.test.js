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
  assert.doesNotMatch(html, /id="undo-button"[^>]*data-i18n="undo"/);
  assert.doesNotMatch(html, /id="redo-button"[^>]*data-i18n="redo"/);
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
  assert.match(
    html,
    /<button value="cancel" class="secondary-button"[^>]*data-i18n="cancel"[^>]*>取消<\/button>/,
  );
  assert.match(
    html,
    /<button id="history-confirm-button" value="confirm" class="danger-button"[^>]*data-i18n="confirm"[^>]*>确认<\/button>/,
  );
});

test("笔记卡片把删除放在编辑旁并先通过统一确认框", () => {
  const renderStart = source.indexOf("function renderNotes(");
  const renderEnd = source.indexOf("\nasync function refresh(", renderStart);
  const renderSource = source.slice(renderStart, renderEnd);
  const confirmation = renderSource.indexOf("confirmHistoryAction(");

  assert.match(renderSource, /deleteButton\.textContent = t\("delete"\)/);
  assert.match(renderSource, /actions\.append\(kind, edit, deleteButton\)/);
  assert.ok(confirmation >= 0, "笔记删除应调用统一确认框");
  assert.match(renderSource.slice(confirmation), /formatTimestamp\(note\.seconds\)/);
  assert.match(
    renderSource.slice(confirmation),
    /description: t\("deleteNoteDescription", \{\s*timestamp: formatTimestamp\(note\.seconds\),\s*\}\)/,
  );
  assert.match(renderSource.slice(confirmation), /operation: "delete", noteId: note\.id/);
  assert.match(
    source,
    /type: "DELETE_NOTE",\s*noteId: action\.noteId,\s*sessionId: action\.sessionId,\s*tabId: action\.tabId/,
  );
  assert.match(
    source,
    /type: "CLEAR_SESSION_NOTES",\s*sessionId: action\.sessionId,\s*tabId: action\.tabId/,
  );
});

test("取消或关闭确认框不执行待定操作", () => {
  const confirmStart = source.indexOf("function confirmHistoryAction(");
  const confirmEnd = source.indexOf("\nfunction ", confirmStart + 1);
  const confirmSource = source.slice(confirmStart, confirmEnd);
  const closeStart = source.indexOf('elements.historyConfirmDialog.addEventListener("close"');
  const closeEnd = source.indexOf("\n});", closeStart) + 4;
  const closeSource = source.slice(closeStart, closeEnd);

  assert.match(confirmSource, /historyConfirmationController\.open\(/);
  assert.match(confirmSource, /showModal\(\)/);
  assert.match(closeSource, /historyConfirmationController\.cancel\(\)/);
  assert.match(closeSource, /historyConfirmationController\.confirm\(\)/);
  assert.match(closeSource, /returnValue !== "confirm"/);
  assert.ok(
    closeSource.indexOf('returnValue !== "confirm"')
      < closeSource.indexOf("historyConfirmationController.confirm()"),
    "取消判断应先于执行待定操作",
  );
});

test("确认接线使用可复核的上下文快照且不保留闭包回调", () => {
  assert.match(source, /createHistoryConfirmationController\(\{/);
  assert.match(source, /historyContextToken/);
  assert.match(source, /historyConfirmationController\.cancel\(\)/);
  assert.match(source, /historyConfirmationController\.confirm\(\)/);
  assert.doesNotMatch(source, /pendingHistoryAction/);
});

test("活动状态驱动历史控件且所有会话历史请求携带侧栏标签页", () => {
  assert.match(source, /canUndo = response\.history\.canUndo/);
  assert.match(source, /canRedo = response\.history\.canRedo/);
  assert.match(source, /historyControlState\(\{/);
  assert.match(source, /blocked: historyInteractionBlocked\(\)/);
  assert.match(source, /\|\| typedDraftSaving/);
  assert.match(source, /\|\| voiceStopping/);
  assert.match(source, /pending: historyOperationController\.pending/);
  assert.match(
    source,
    /description: t\("clearNotesDescription", \{ count: savedNoteCount\(\) \}\)/,
  );

  for (const type of [
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
  assert.match(source, /refresh: \(\) => refreshRunner\.runUntilApplied\(\)/);
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

test("窄侧栏时间线标题与操作按钮保持单行对齐", () => {
  assert.match(html, /<div class="section-row timeline-header">/);
  assert.match(css, /#timeline-title\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(
    css,
    /\.timeline-header\s*\{[^}]*justify-content:\s*flex-start;[^}]*flex-wrap:\s*nowrap/s,
  );
  assert.match(
    css,
    /\.timeline-actions\s*\{[^}]*display:\s*flex;[^}]*flex:\s*0\s+0\s+auto;[^}]*flex-wrap:\s*nowrap/s,
  );
  assert.match(
    css,
    /\.timeline-actions\s*>\s*button\s*\{[^}]*flex:\s*0\s+0\s+auto;[^}]*width:\s*auto/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*480px\)[\s\S]*\.timeline-header\s*\{[^}]*gap:\s*1px/s,
  );
  assert.match(css, /\.danger-button[\s\S]*border[^;]*#[0-9a-f]{6}/i);
  assert.match(css, /\.note-delete-button[\s\S]*color[^;]*#[0-9a-f]{6}/i);
  assert.match(css, /min-width:\s*320px/);
});

test("侧栏重新打开后按视频恢复整页滚动位置", () => {
  assert.match(
    source,
    /createSidePanelViewPositionController\(\{[\s\S]*readPagePosition:\s*\(\)\s*=>\s*window\.scrollY,[\s\S]*restorePagePosition:\s*\(position\)\s*=>\s*window\.scrollTo\(0, position\)/,
  );
  assert.match(source, /sidePanelViewPosition\.activate\(response\.context\.sessionId\)/);
  assert.match(
    source,
    /sidePanelViewPosition\.restorePage\(\{\s*deferIfClamped: activeContext\.platform === "youtube",\s*\}\)/,
  );
  assert.match(source, /window\.addEventListener\("scroll",[\s\S]*sidePanelViewPosition\.scheduleSave\(\)/);
  assert.match(source, /window\.addEventListener\("pagehide", \(\) => \{\s*void sidePanelViewPosition\.flush\(\);/);
});
