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

test("完整字幕缓存可跨侧栏仓库实例读取", async () => {
  const databaseName = `transcript-cache-${crypto.randomUUID()}`;
  const first = new VideoNotesRepository({ databaseName, indexedDB, IDBKeyRange });
  await first.putTranscriptCache({
    id: "youtube:abc",
    schemaVersion: 1,
    videoId: "abc",
    transcript: {
      ok: true,
      videoId: "abc",
      cues: [{ startMs: 0, endMs: 1000, text: "字幕" }],
    },
    translationSets: {},
    updatedAt: 1,
  });
  first.close();

  const second = new VideoNotesRepository({ databaseName, indexedDB, IDBKeyRange });
  assert.equal(
    (await second.getTranscriptCache("youtube:abc")).transcript.cues[0].text,
    "字幕",
  );
  await second.destroy();
});

test("旧版数据库升级后保留笔记并新增完整字幕缓存", async () => {
  const databaseName = `transcript-cache-upgrade-${crypto.randomUUID()}`;
  const legacyRequest = indexedDB.open(databaseName, 2);
  legacyRequest.onupgradeneeded = () => {
    const database = legacyRequest.result;
    database.createObjectStore("sessions", { keyPath: "id" });
    const notes = database.createObjectStore("notes", { keyPath: "id" });
    notes.createIndex("sessionId", "sessionId", { unique: false });
    database.createObjectStore("assets", { keyPath: "key" });
    database.createObjectStore("history", { keyPath: "sessionId" });
  };
  const legacyDatabase = await new Promise((resolve, reject) => {
    legacyRequest.onsuccess = () => resolve(legacyRequest.result);
    legacyRequest.onerror = () => reject(legacyRequest.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = legacyDatabase.transaction("notes", "readwrite");
    transaction.objectStore("notes").put({
      id: "legacy-note",
      sessionId: "youtube:abc",
      status: "saved",
      createdAt: 1,
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  legacyDatabase.close();

  const repository = new VideoNotesRepository({ databaseName, indexedDB, IDBKeyRange });
  assert.equal((await repository.getNote("legacy-note")).id, "legacy-note");
  await repository.putTranscriptCache({ id: "youtube:abc", schemaVersion: 1 });
  assert.equal((await repository.getTranscriptCache("youtube:abc")).schemaVersion, 1);
  await repository.destroy();
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

test("已删除笔记拒绝陈旧正文编辑且删除仍可撤销", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "n1",
    sessionId: "youtube:abc",
    status: "saved",
    body: "删除前正文",
    subtitleContext: "删除前字幕",
    createdAt: 1,
  });

  await repository.deleteSavedNote("n1", 10);
  await assert.rejects(
    repository.editNoteBody("n1", "陈旧正文", 20),
    /笔记历史动作已过期/,
  );
  assert.deepEqual(
    (await repository.read("history", "youtube:abc")).undo.map((action) => action.type),
    ["delete-note"],
  );

  await repository.undoNoteAction("youtube:abc", 30);
  assert.equal((await repository.listNotes("youtube:abc"))[0].body, "删除前正文");
  await repository.destroy();
});

test("已删除笔记拒绝陈旧字幕编辑且删除仍可撤销", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "n1",
    sessionId: "youtube:abc",
    status: "saved",
    body: "删除前正文",
    subtitleContext: "删除前字幕",
    createdAt: 1,
  });

  await repository.deleteSavedNote("n1", 10);
  await assert.rejects(
    repository.editNoteSubtitle("n1", "陈旧字幕", 20),
    /笔记历史动作已过期/,
  );
  assert.deepEqual(
    (await repository.read("history", "youtube:abc")).undo.map((action) => action.type),
    ["delete-note"],
  );

  await repository.undoNoteAction("youtube:abc", 30);
  assert.equal((await repository.listNotes("youtube:abc"))[0].subtitleContext, "删除前字幕");
  await repository.destroy();
});

test("尚未保存的草稿拒绝正文编辑且不产生历史", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "n1",
    sessionId: "youtube:abc",
    status: "draft",
    body: "草稿正文",
    createdAt: 1,
  });

  await assert.rejects(
    repository.editNoteBody("n1", "陈旧正文", 10),
    /笔记历史动作已过期/,
  );
  assert.equal(await repository.read("history", "youtube:abc"), undefined);
  assert.equal((await repository.getNote("n1")).body, "草稿正文");
  await repository.destroy();
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

test("字幕编辑及其撤销反撤销不改变正文编辑版本", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "n1",
    sessionId: "youtube:abc",
    status: "saved",
    subtitleContext: "旧字幕",
    userEditVersion: 0,
    createdAt: 1,
  });

  await repository.editNoteSubtitle("n1", "新字幕", 10);
  assert.equal((await repository.getNote("n1")).userEditVersion, 0);
  await repository.undoNoteAction("youtube:abc", 20);
  assert.deepEqual(await repository.getNote("n1"), {
    id: "n1",
    sessionId: "youtube:abc",
    status: "saved",
    subtitleContext: "旧字幕",
    userEditVersion: 0,
    createdAt: 1,
    updatedAt: 20,
  });
  await repository.redoNoteAction("youtube:abc", 30);
  assert.equal((await repository.getNote("n1")).userEditVersion, 0);
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

test("清理不可恢复笔记时保留跨会话仍在引用的共享资产", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putAsset("screenshot/shared", new Blob(["image"], { type: "image/png" }));
  await repository.putAsset("audio/shared", new Blob(["audio"], { type: "audio/webm" }));
  await repository.putNote({
    id: "expired",
    sessionId: "youtube:abc",
    status: "draft",
    screenshotKey: "screenshot/shared",
    audioKey: "audio/shared",
    createdAt: 1,
  });
  await repository.putNote({
    id: "visible",
    sessionId: "youtube:def",
    status: "saved",
    screenshotKey: "screenshot/shared",
    audioKey: "audio/shared",
    createdAt: 2,
  });
  await repository.commitSavedNote("expired", { status: "saved" }, 1);
  await repository.updateNote("expired", (note) => ({ ...note, deletedAt: 2 }));

  for (let index = 0; index < 50; index += 1) {
    const id = `n${index}`;
    await repository.putNote({ id, sessionId: "youtube:abc", status: "draft", createdAt: index + 3 });
    await repository.commitSavedNote(id, { status: "saved" }, index + 3);
  }

  assert.equal(await repository.getNote("expired"), undefined);
  assert.equal((await repository.listNotes("youtube:def"))[0].id, "visible");
  assert.equal(await (await repository.getAsset("screenshot/shared")).text(), "image");
  assert.equal(await (await repository.getAsset("audio/shared")).text(), "audio");
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

test("历史事务先派发 abort 再以原始回调错误拒绝", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  const database = await repository.dbPromise;
  const originalTransaction = database.transaction.bind(database);
  let abortObserved = false;
  database.transaction = (...args) => {
    const transaction = originalTransaction(...args);
    if (Array.from(args[0]).includes("history")) {
      transaction.addEventListener("abort", () => {
        abortObserved = true;
      });
    }
    return transaction;
  };
  const callbackError = new Error("停止历史事务");

  try {
    await assert.rejects(
      repository.mutateHistory("youtube:abc", 10, () => {
        throw callbackError;
      }),
      (error) => {
        assert.equal(abortObserved, true);
        assert.equal(error, callbackError);
        return true;
      },
    );
  } finally {
    database.transaction = originalTransaction;
    await repository.destroy();
  }
});
