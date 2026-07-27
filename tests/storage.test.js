import assert from "node:assert/strict";
import test from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { VideoNotesRepository } from "../src/core/storage.js";

test("会话、标记和二进制资产可跨仓库实例读取", async () => {
  const databaseName = `video-notes-test-${crypto.randomUUID()}`;
  const first = new VideoNotesRepository({ databaseName, indexedDB, IDBKeyRange });
  await first.putSession({ id: "youtube:abc", title: "课程" });
  await first.putNote({ id: "n2", sessionId: "youtube:abc", createdAt: 2, body: "后" });
  await first.putNote({ id: "n1", sessionId: "youtube:abc", createdAt: 1, body: "前" });
  await first.putAsset("audio/n1", new Blob(["voice"], { type: "audio/webm" }));
  first.close();

  const second = new VideoNotesRepository({ databaseName, indexedDB, IDBKeyRange });
  assert.equal((await second.getSession("youtube:abc")).title, "课程");
  assert.deepEqual(
    (await second.listNotes("youtube:abc")).map((note) => note.id),
    ["n1", "n2"],
  );
  assert.equal(await (await second.getAsset("audio/n1")).text(), "voice");

  const updated = await second.updateNote("n2", (note) => ({
    ...note,
    body: "用户修订",
    userEditVersion: 1,
  }));
  assert.equal(updated.body, "用户修订");
  assert.equal((await second.getNote("n2")).userEditVersion, 1);

  await second.deleteNote("n1");
  await second.deleteAsset("audio/n1");
  assert.equal(await second.getNote("n1"), undefined);
  assert.equal(await second.getAsset("audio/n1"), undefined);
  await second.destroy();
});

test("可恢复已经保存音频但尚未完成的转写任务", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `video-notes-test-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "pending",
    sessionId: "youtube:abc",
    status: "saved",
    audioKey: "audio/pending",
    transcriptionStatus: "transcribing",
  });
  await repository.putNote({
    id: "done",
    sessionId: "youtube:abc",
    status: "saved",
    audioKey: "audio/done",
    transcriptionStatus: "complete",
  });
  assert.deepEqual(
    (await repository.listPendingTranscriptions()).map((note) => note.id),
    ["pending"],
  );
  await repository.destroy();
});

test("新增、修改、删除和跨实例撤销共享持久历史", async () => {
  const databaseName = `history-${crypto.randomUUID()}`;
  const first = new VideoNotesRepository({ databaseName, indexedDB, IDBKeyRange });
  await first.putNote({
    id: "n1",
    sessionId: "youtube:abc",
    status: "draft",
    body: "",
    createdAt: 1,
  });
  await first.commitSavedNote("n1", { status: "saved", body: "第一条" }, 10);
  await first.editNoteBody("n1", "修改后", 20);
  await first.deleteSavedNote("n1", 30);
  assert.deepEqual(await first.listNotes("youtube:abc"), []);
  first.close();

  const second = new VideoNotesRepository({ databaseName, indexedDB, IDBKeyRange });
  await second.undoNoteAction("youtube:abc", 40);
  assert.equal((await second.listNotes("youtube:abc"))[0].body, "修改后");
  await second.undoNoteAction("youtube:abc", 50);
  assert.equal((await second.getNote("n1")).body, "第一条");
  await second.destroy();
});

test("清空会话作为单个动作整体恢复可见笔记", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({ id: "n1", sessionId: "youtube:abc", status: "saved", createdAt: 1 });
  await repository.putNote({ id: "n2", sessionId: "youtube:abc", status: "saved", createdAt: 2 });

  await repository.clearSessionNotes("youtube:abc", 10);
  assert.deepEqual(await repository.listNotes("youtube:abc"), []);
  await repository.undoNoteAction("youtube:abc", 20);
  assert.deepEqual(
    (await repository.listNotes("youtube:abc")).map((note) => note.id),
    ["n1", "n2"],
  );
  await repository.destroy();
});

test("反撤销会重新应用删除动作", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({ id: "n1", sessionId: "youtube:abc", status: "saved", createdAt: 1 });

  await repository.deleteSavedNote("n1", 10);
  await repository.undoNoteAction("youtube:abc", 20);
  await repository.redoNoteAction("youtube:abc", 30);
  assert.deepEqual(await repository.listNotes("youtube:abc"), []);
  await repository.destroy();
});

test("规范化后未变化的编辑不新增历史动作", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "n1",
    sessionId: "youtube:abc",
    status: "draft",
    body: "",
    createdAt: 1,
  });
  await repository.commitSavedNote("n1", { status: "saved", body: "原文" }, 10);

  await repository.editNoteBody("n1", "  原文  ", 20);
  await repository.undoNoteAction("youtube:abc", 30);
  assert.deepEqual(await repository.listNotes("youtube:abc"), []);
  await repository.destroy();
});

test("待转写扫描忽略已软删除笔记", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "visible",
    sessionId: "youtube:abc",
    status: "saved",
    audioKey: "audio/visible",
    transcriptionStatus: "pending",
  });
  await repository.putNote({
    id: "deleted",
    sessionId: "youtube:abc",
    status: "saved",
    audioKey: "audio/deleted",
    transcriptionStatus: "transcribing",
    deletedAt: 1,
  });

  assert.deepEqual(
    (await repository.listPendingTranscriptions()).map((note) => note.id),
    ["visible"],
  );
  await repository.destroy();
});

test("超过五十条历史后会清理不可恢复笔记及其资产", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "expired",
    sessionId: "youtube:abc",
    status: "draft",
    screenshotKey: "screenshot/expired",
    audioKey: "audio/expired",
    createdAt: 1,
  });
  await repository.putAsset("screenshot/expired", new Blob(["image"], { type: "image/png" }));
  await repository.putAsset("audio/expired", new Blob(["audio"], { type: "audio/webm" }));
  await repository.commitSavedNote("expired", { status: "saved" }, 1);
  await repository.updateNote("expired", (note) => ({ ...note, deletedAt: 2 }));

  for (let index = 0; index < 50; index += 1) {
    const id = `n${index}`;
    await repository.putNote({ id, sessionId: "youtube:abc", status: "draft", createdAt: index + 3 });
    await repository.commitSavedNote(id, { status: "saved" }, index + 3);
  }

  assert.equal(await repository.getNote("expired"), undefined);
  assert.equal(await repository.getAsset("screenshot/expired"), undefined);
  assert.equal(await repository.getAsset("audio/expired"), undefined);
  await repository.destroy();
});

test("抛出的笔记更新器不会提交笔记或历史的部分状态", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "n1",
    sessionId: "youtube:abc",
    status: "draft",
    body: "初始",
    createdAt: 1,
  });
  await repository.commitSavedNote("n1", { status: "saved" }, 10);

  await assert.rejects(
    repository.updateNote("n1", () => {
      throw new Error("停止更新");
    }),
    /停止更新/,
  );
  assert.equal((await repository.getNote("n1")).body, "初始");
  await repository.undoNoteAction("youtube:abc", 20);
  assert.deepEqual(await repository.listNotes("youtube:abc"), []);
  await repository.destroy();
});
