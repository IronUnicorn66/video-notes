import assert from "node:assert/strict";
import test from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { buildTranscriptExport, buildSessionExport } from "../src/core/session-export.js";
import { VideoNotesRepository } from "../src/core/storage.js";

const session = { id: "youtube:lesson", platform: "youtube", videoId: "lesson", part: 1,
  title: "Course [one]", canonicalUrl: "https://www.youtube.com/watch?v=lesson" };
const transcript = { ok: true, videoId: "lesson", source: "youtube-caption-track", languageCode: "en",
  automatic: false, label: "English", cues: [
    { startMs: 1250, endMs: 2875, text: "Original **English** <text>\nSecond line" },
    { startMs: 3600123, endMs: 3602345, text: "The final section." },
  ] };

test("全量导出逐条保留原文、毫秒时间、来源和稳定 ID，时间点可跳转", () => {
  const result = buildTranscriptExport(session, transcript);
  const files = new Map(result.files.map((file) => [file.name, file.data]));
  const json = JSON.parse(files.get("transcript/original.json"));
  assert.deepEqual(json.cues.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })), transcript.cues);
  assert.equal(json.cues[0].id, "cue-000001");
  assert.equal(json.cues[1].jumpUrl, "https://www.youtube.com/watch?v=lesson&t=3600s");
  assert.equal(json.languageCode, "en");
  assert.equal(json.automatic, false);
  assert.equal(json.coverage.cueCount, 2);
  assert.equal(json.coverage.endMs, 3602345);
  assert.equal(json.segmentation, "source-cues");
  assert.match(files.get("transcript/original.srt"), /00:00:01,250 --> 00:00:02,875/);
  assert.match(files.get("transcript/original.srt"), /01:00:00,123 --> 01:00:02,345/);
  const markdown = files.get("transcript/original.md");
  assert.match(markdown, /\[01:00:00,123 → 01:00:02,345\]\(https:\/\/www.youtube.com\/watch\?v=lesson&t=3600s\)/);
  assert.match(markdown, /&lt;text&gt;/);
  assert.ok(markdown.includes('\\*\\*English\\*\\*'));
  assert.match(markdown, /未与整段音频核验/);
});

test("导出拒绝错误视频、空字幕、非法时间，保留原语言和重叠字幕", () => {
  for (const invalid of [null, { ...transcript, videoId: "other" }, { ...transcript, ok: false },
    { ...transcript, cues: [] }, ...[
      { startMs: -1, endMs: 5, text: "bad" },
      { startMs: 3, endMs: 1, text: "bad" },
      { startMs: NaN, endMs: 5, text: "bad" },
      { startMs: 0, endMs: 5, text: "" },
    ].map((cue) => ({ ...transcript, cues: [cue] })),
  ]) assert.equal(buildTranscriptExport(session, invalid), null);
  const result = buildTranscriptExport(session, { ...transcript, languageCode: "fr", cues: [
    { startMs: 0, endMs: 2000, text: "Bonjour" }, { startMs: 1000, endMs: 3000, text: "Bonjour" },
  ] }, "en");
  assert.equal(result.metadata.languageCode, "fr");
  assert.equal(result.metadata.cues.length, 2);
});

test("SRT 在小时边界舍入时间，JSON 保留来源精度", () => {
  const result = buildTranscriptExport(session, { ...transcript, cues: [
    { startMs: 3599999.8, endMs: 3601000.4, text: "a\n\nb" },
  ] });
  assert.equal(result.metadata.cues[0].startMs, 3599999.8);
  assert.match(result.files[1].data, /01:00:00,000 --> 01:00:01,000\na\nb/);
});

test("完整 ZIP 内容支持无批注课程、保留旧附件、不导出草稿或其他课程", async () => {
  const repository = new VideoNotesRepository({ databaseName: `export-${crypto.randomUUID()}`, indexedDB, IDBKeyRange });
  try {
    const empty = await buildSessionExport({ repository, session, transcript });
    assert.equal(empty.noteCount, 0);
    assert.equal(empty.transcriptCueCount, 2);
    assert.equal(JSON.parse(empty.files.find((f) => f.name === "export.json").data).kind, "video-notes-export");
    await repository.putNote({ id: "saved", sessionId: session.id, status: "saved", seconds: 1, body: "我的批注",
      jumpUrl: "https://www.youtube.com/watch?v=lesson&t=1s", screenshotKey: "image", audioKey: "legacy-audio", createdAt: 1 });
    await repository.putNote({ id: "draft", sessionId: session.id, status: "draft", body: "draft", createdAt: 2 });
    await repository.putNote({ id: "other", sessionId: "youtube:other", status: "saved", body: "other", createdAt: 3 });
    await repository.putAsset("image", new Blob(["image-bytes"]));
    await repository.putAsset("legacy-audio", new Blob(["audio-bytes"]));
    const result = await buildSessionExport({ repository, session, transcript });
    assert.equal(result.noteCount, 1);
    const files = new Map(result.files.map((f) => [f.name, f.data]));
    assert.equal(new TextDecoder().decode(files.get("audio/001_00-00-01.webm")), "audio-bytes");
    assert.equal(new TextDecoder().decode(files.get("images/001_00-00-01.webp")), "image-bytes");
    assert.ok(files.get(result.filenames.markdown).indexOf("我的批注") < files.get(result.filenames.markdown).indexOf("## 完整原文字幕"));
    assert.doesNotMatch(files.get(result.filenames.markdown), /draft|other/);
    assert.match(files.get(result.filenames.markdown), /\(transcript\/original.json\)/);
    assert.equal((await repository.getNote("saved")).body, "我的批注");
    assert.equal(await (await repository.getAsset("legacy-audio")).text(), "audio-bytes");
  } finally { await repository.destroy(); }
});

test("字幕或旧附件缺失时仍导出笔记并明确记录缺口", async () => {
  const result = await buildSessionExport({ repository: {
    async listNotes() { return [{ status: "saved", seconds: 2, body: "kept", audioKey: "missing", jumpUrl: "https://example.com" }]; },
    async getAsset() { return undefined; },
  }, session, transcript: { ...transcript, videoId: "other" }, language: "en" });
  const manifest = JSON.parse(result.files.find((f) => f.name === "export.json").data);
  assert.equal(manifest.transcript.status, "unavailable");
  assert.equal(result.transcriptCueCount, 0);
  assert.equal(result.files.some((f) => f.name.startsWith("transcript/")), false);
  assert.match(result.files[0].data, /No full original transcript was available/);
  assert.match(result.files[0].data, /kept/);
  assert.match(result.files[0].data, /missing/i);
});
