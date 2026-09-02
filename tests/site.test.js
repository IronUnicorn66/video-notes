import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("双语主页按问题、用法和价值组织核心信息", async () => {
  const [zhHome, enHome] = await Promise.all([
    read("docs/index.html"),
    read("docs/en/index.html"),
  ]);

  for (const html of [zhHome, enHome]) {
    const problem = html.indexOf('id="problem"');
    const how = html.indexOf('id="how"');
    const install = html.indexOf('id="install"');
    const value = html.indexOf('id="value"');
    assert.ok(problem >= 0 && problem < how, "问题区应位于用法区之前");
    assert.ok(how < install && install < value, "安装说明应合并到用法区");
    assert.equal(html.match(/class="step-number"/g)?.length, 4);
    assert.equal(html.match(/class="value-card"/g)?.length, 3);
    assert.doesNotMatch(
      html,
      /id="features"|class="numbers\b|feature-grid|local-section|support-section/,
    );
    assert.match(html, /github\.com\/IronUnicorn66\/video-notes\/issues/);
    assert.match(
      html,
      /releases\/download\/v1\.0\.26\/video-notes-edge-1\.0\.26\.zip/,
    );
    assert.match(html, /YouTube/);
    assert.match(html, /Bilibili|哔哩哔哩/);
  }

  assert.match(zhHome, /视频笔记/);
  assert.match(enHome, /Video Notes/);
  assert.match(zhHome, /href="privacy\/"/);
  assert.match(enHome, /href="privacy\/"/);
});

test("隐私页覆盖本地存储、本地翻译、模型下载和删除", async () => {
  const [html, englishHtml] = await Promise.all([
    read("docs/privacy/index.html"),
    read("docs/en/privacy/index.html"),
  ]);

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
  assert.match(html, /全文翻译/);
  assert.match(html, /Translator API/);
  assert.match(html, /自动识别源语言/);
  assert.match(html, /简体中文、英语、日语、韩语或西班牙语作为目标语言/);
  assert.match(html, /不会发送给扩展开发者或第三方翻译服务/);
  assert.match(englishHtml, /Local full-transcript translation/);
  assert.match(englishHtml, /detects the source language/);
  assert.match(englishHtml, /choose Simplified Chinese, English, Japanese, Korean, or Spanish as the target/);
  assert.match(englishHtml, /not sent to the developer or a third-party translation service/);
  for (const page of [html, englishHtml]) {
    assert.doesNotMatch(page, /API Key|OpenAI|cloud backup|云端备用/);
  }
});

test("官网提供可切换的中英文主页与隐私页", async () => {
  const [zhHome, enHome, zhPrivacy, enPrivacy] = await Promise.all([
    read("docs/index.html"),
    read("docs/en/index.html"),
    read("docs/privacy/index.html"),
    read("docs/en/privacy/index.html"),
  ]);

  assert.match(zhHome, /data-language="en"/);
  assert.match(enHome, /<html lang="en" data-language="en">/);
  assert.match(enHome, /screenshot-1-note-en\.png/);
  assert.match(enPrivacy, /Connection metadata/);
  assert.match(enPrivacy, /delete your data/i);
  assert.match(zhPrivacy, /data-language="en"/);
  for (const html of [zhHome, enHome, zhPrivacy, enPrivacy]) {
    assert.match(html, /language\.js/);
  }
});

test("站点不加载第三方脚本、字体或分析服务", async () => {
  for (const file of [
    "docs/index.html",
    "docs/privacy/index.html",
    "docs/en/index.html",
    "docs/en/privacy/index.html",
  ]) {
    const html = await read(file);
    assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
    assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/i);
    assert.doesNotMatch(html, /google-analytics|googletagmanager|plausible|umami/i);
  }
});

test("站点提供窄屏和减少动态效果样式", async () => {
  const css = await read("docs/styles.css");

  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.match(css, /:not\(\[data-language\]\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
});

test("GitHub Pages 静态资源齐全", async () => {
  await access(new URL("../docs/.nojekyll", import.meta.url));
  await access(new URL("../docs/assets/icon.svg", import.meta.url));
});
