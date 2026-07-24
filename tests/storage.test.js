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
