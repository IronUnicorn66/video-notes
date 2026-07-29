import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("主页提供产品流程、下载、隐私与支持入口", async () => {
  const html = await read("docs/index.html");

  assert.match(html, /视频笔记/);
  assert.match(html, /id="how"/);
  assert.match(html, /id="features"/);
  assert.match(
    html,
    /https:\/\/github\.com\/IronUnicorn66\/video-notes\/releases\/download\/v1\.0\.2\/video-notes-edge-1\.0\.2\.zip/,
  );
  assert.match(html, /href="privacy\/"/);
  assert.match(html, /https:\/\/github\.com\/IronUnicorn66\/video-notes\/issues/);
  assert.match(html, /YouTube/);
  assert.match(html, /哔哩哔哩/);
});

test("隐私页覆盖本地存储、模型下载、权限和删除", async () => {
  const html = await read("docs/privacy/index.html");

  for (const term of [
    "IndexedDB",
    "Cache Storage",
    "Hugging Face",
    "连接元数据",
    "麦克风",
    "播放器截图",
    "删除",
  ]) {
    assert.ok(html.includes(term), `隐私页缺少 ${term}`);
  }
  assert.match(html, /https:\/\/huggingface\.co\/privacy/);
  assert.match(html, /github\.com\/IronUnicorn66\/video-notes\/issues/);
});

test("站点不加载第三方脚本、字体或分析服务", async () => {
  for (const file of ["docs/index.html", "docs/privacy/index.html"]) {
    const html = await read(file);
    assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
    assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/i);
    assert.doesNotMatch(html, /google-analytics|googletagmanager|plausible|umami/i);
  }
});

test("站点提供窄屏和减少动态效果样式", async () => {
  const css = await read("docs/styles.css");

  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
});

test("GitHub Pages 静态资源齐全", async () => {
  await access(new URL("../docs/.nojekyll", import.meta.url));
  await access(new URL("../docs/assets/icon.svg", import.meta.url));
});
