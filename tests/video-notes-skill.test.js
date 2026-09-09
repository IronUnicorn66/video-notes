import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSessionExport } from "../src/core/session-export.js";
import { createZip } from "../src/core/zip.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const scripts = path.join(root, "skills/video-notes/scripts");
function python(...args) {
  return execFileSync("python3", ["-B", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
}

test("配套 skill 的导入、章节校验、旧版兼容与安装备份行为", () => {
  python("-m", "unittest", "discover", "-s", "tests", "-p", "skill_video_notes_test.py");
});

test("扩展实际导出文件可由仓库 skill 解压并生成带时间和来源的课程地图", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "video-notes-skill-"));
  try {
    const session = { id: "youtube:synthetic", platform: "youtube", videoId: "synthetic", part: 1,
      title: "Synthetic course", canonicalUrl: "https://www.youtube.com/watch?v=synthetic" };
    const transcript = { ok: true, videoId: "synthetic", source: "youtube-caption-track", languageCode: "en", cues: [
      { startMs: 1250.5, endMs: 2200.5, text: "This is a synthetic fixture, not a real course." },
      { startMs: 3600000, endMs: 3601500, text: "This final section tests the hour boundary." },
    ] };
    const exported = await buildSessionExport({ repository: { async listNotes() { return []; } }, session, transcript });
    const zip = path.join(dir, "course.zip");
    await writeFile(zip, createZip(exported.files));
    const extracted = path.join(dir, "extracted");
    const report = JSON.parse(python(path.join(scripts, "inspect_export.py"), zip, "--extract-to", extracted));
    assert.equal(report.note_count, 0);
    assert.equal(report.notes_file, exported.filenames.markdown);
    const source = path.join(extracted, report.transcript_file);
    assert.deepEqual(JSON.parse(await readFile(source)).cues.map(({ text }) => text), transcript.cues.map(({ text }) => text));
    const plan = path.join(dir, "plan.json");
    await writeFile(plan, JSON.stringify({ chapters: transcript.cues.map((_, index) => ({
      titleZh: index ? "小时边界检查" : "合成测试说明", summaryZh: "用于验证工具流程的合成内容。",
      startCueId: `cue-00000${index + 1}`, endCueId: `cue-00000${index + 1}`,
    })) }));
    const output = path.join(dir, "map.json");
    python(path.join(scripts, "render_course_map.py"), "--transcript", source, "--plan", plan,
      "--export-file", "course.zip", "--output", path.join(dir, "map.md"), "--json-output", output);
    const map = JSON.parse(await readFile(output));
    assert.equal(map.cueCount, 2);
    assert.equal(map.chapters[0].startMs, 1250.5);
    assert.equal(map.chapters[1].jumpUrl, "https://www.youtube.com/watch?v=synthetic&t=3600s");
    assert.equal(map.sessionId, session.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
