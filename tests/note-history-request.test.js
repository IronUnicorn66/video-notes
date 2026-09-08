import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { createNoteHistoryCommandRouter } from "../src/core/note-history-commands.js";
import {
  sidePanelRequestTabIdForSender,
  sidePanelTabIdForSender,
  standalonePanelRequestTabId,
} from "../src/core/sidepanel-scope.js";
import { VideoNotesRepository } from "../src/core/storage.js";

const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
// 执行后台实际的请求校验入口，覆盖命令路由之前的拦截。
const requestSource = background.slice(
  background.indexOf("const NOTE_ID_MUTATION_COMMANDS ="),
  background.indexOf("\nasync function sidePanelTargetTab("),
);

async function fixture(t, mode = "sidepanel") {
  const repository = new VideoNotesRepository({
    databaseName: `note-request-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  t.after(() => repository.destroy());
  const sender = { documentId: "panel-document" };
  const context = { mode, tabId: 22, windowId: 3 };
  let sessionId = "youtube:course";
  const currentPageContext = async () => sessionId ? { sessionId } : null;
  const resolveRequest = runInNewContext(`${requestSource}\nnoteHistoryRequest`, {
    repository,
    isPanelSender: () => true,
    currentPageContext,
    resolveSidePanelContext: async () => ({
      context,
      contexts: [{ contextType: "SIDE_PANEL", documentId: sender.documentId, ...context }],
      fallbackTab: null,
    }),
    sidePanelTabIdForSender,
    sidePanelRequestTabIdForSender,
    sidePanelTargetTab: async (_sender, tabId) => ({
      id: standalonePanelRequestTabId(context, tabId),
    }),
    chrome: { tabs: { query: async () => [{ id: context.tabId, windowId: context.windowId }] } },
  });
  const route = createNoteHistoryCommandRouter({ repository, getCurrentContext: currentPageContext });
  await repository.putNote({
    id: "saved-note",
    sessionId,
    tabId: 11,
    status: "saved",
    body: "之前标签页记录的正文",
    subtitleContext: "前置字幕",
    screenshotKey: "screenshot/saved-note",
    createdAt: 1,
  });
  await repository.putAsset("screenshot/saved-note", new Blob(["screenshot"]));
  return {
    repository,
    setSession(value) { sessionId = value; },
    async send(message) {
      const payload = { tabId: context.tabId, ...message };
      return route(payload, await resolveRequest(payload, sender));
    },
  };
}

for (const mode of ["sidepanel", "standalone"]) {
  test(`${mode} 重新打开同一视频后可删除旧标签页笔记并撤销恢复截图`, async (t) => {
    const { repository, send } = await fixture(t, mode);
    assert.equal((await send({ type: "GET_ACTIVE_STATE" })).notes.length, 1);
    await send({ type: "DELETE_NOTE", noteId: "saved-note", sessionId: "youtube:course" });
    assert.deepEqual(await repository.listNotes("youtube:course"), []);
    await send({ type: "UNDO_NOTE_ACTION", sessionId: "youtube:course" });
    assert.equal((await repository.listNotes("youtube:course"))[0].body, "之前标签页记录的正文");
    assert.equal(await (await repository.getAsset("screenshot/saved-note")).text(), "screenshot");
    await send({ type: "REDO_NOTE_ACTION", sessionId: "youtube:course" });
    assert.deepEqual(await repository.listNotes("youtube:course"), []);
  });
}

test("同一视频的旧标签页笔记仍可编辑正文和字幕", async (t) => {
  const { repository, send } = await fixture(t);
  await send({ type: "UPDATE_NOTE_BODY", noteId: "saved-note", body: "修订正文" });
  await send({ type: "UPDATE_NOTE_SUBTITLE", noteId: "saved-note", subtitleContext: "修订字幕" });
  const note = await repository.getNote("saved-note");
  assert.equal(note.body, "修订正文");
  assert.equal(note.subtitleContext, "修订字幕");
  assert.equal(note.tabId, 11);
});

test("切换到其他视频或无有效页面后拒绝删除和编辑旧笔记", async (t) => {
  const { repository, send, setSession } = await fixture(t);
  // 标签页编号相同也不能绕过视频会话校验。
  await repository.updateNote("saved-note", (note) => ({ ...note, tabId: 22 }));
  for (const session of ["youtube:other", null]) {
    setSession(session);
    for (const type of ["DELETE_NOTE", "UPDATE_NOTE_BODY", "UPDATE_NOTE_SUBTITLE"]) {
      await assert.rejects(send({
        type,
        noteId: "saved-note",
        sessionId: "youtube:course",
        body: "错误正文",
        subtitleContext: "错误字幕",
      }), /当前页面会话/);
    }
  }
  const note = await repository.getNote("saved-note");
  assert.equal(note.deletedAt, undefined);
  assert.equal(note.body, "之前标签页记录的正文");
  assert.equal(note.subtitleContext, "前置字幕");
});

test("同一视频也不能提交其他标签页的未完成草稿", async (t) => {
  const { repository, send } = await fixture(t);
  await repository.putNote({
    id: "draft-note", sessionId: "youtube:course", tabId: 11, status: "draft", body: "", createdAt: 2,
  });
  await assert.rejects(send({
    type: "COMMIT_TYPED_NOTE", noteId: "draft-note", body: "其他标签页的输入",
  }), /标记不属于当前标签页/);
  assert.equal((await repository.getNote("draft-note")).status, "draft");
});

test("当前标签页的新笔记提交后仍可删除且缺失笔记不会改变历史", async (t) => {
  const { repository, send } = await fixture(t);
  await repository.putNote({
    id: "new-note", sessionId: "youtube:course", tabId: 22, status: "draft", body: "", createdAt: 2,
  });
  await send({ type: "COMMIT_TYPED_NOTE", noteId: "new-note", body: "新笔记" });
  await send({ type: "DELETE_NOTE", noteId: "new-note", sessionId: "youtube:course" });
  assert.deepEqual((await repository.listNotes("youtube:course")).map((note) => note.id), ["saved-note"]);
  const history = await repository.getNoteHistoryState("youtube:course");
  await assert.rejects(send({
    type: "DELETE_NOTE", noteId: "missing", sessionId: "youtube:course",
  }), /标记不属于当前页面会话/);
  assert.deepEqual(await repository.getNoteHistoryState("youtube:course"), history);
});

test("删除请求不能伪造侧栏绑定或笔记所属的视频会话", async (t) => {
  const { repository, send } = await fixture(t);
  await assert.rejects(send({
    type: "DELETE_NOTE", noteId: "saved-note", sessionId: "youtube:course", tabId: 99,
  }), /侧栏所属标签页已变化/);
  await assert.rejects(send({
    type: "DELETE_NOTE", noteId: "saved-note", sessionId: "youtube:other",
  }), /当前页面会话不匹配/);
  assert.equal((await repository.getNote("saved-note")).deletedAt, undefined);
});
