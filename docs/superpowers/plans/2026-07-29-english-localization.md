# English Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为扩展界面、官网和 GitHub README 提供可自动选择、可手动切换并记住偏好的完整英文体验。

**Architecture:** 扩展使用一个纯 JavaScript 双语消息目录和一个浏览器存储适配层，所有扩展上下文共享语言代码与消息键；侧栏通过重新加载应用手动语言选择，导出请求显式携带语言。官网继续静态托管，通过独立中英文路径提供可索引正文，并用一个轻量本地脚本处理首次跳转和偏好保存。

**Tech Stack:** JavaScript ES modules、Chrome Extension i18n、Manifest V3、Node.js 内置测试运行器、静态 HTML/CSS、esbuild、Sharp。

## Global Constraints

- 本次发布版本固定为 `1.0.3`。
- 产品英文名固定为 `Video Notes`，中文名保持“视频笔记”。
- 扩展首次按 Edge 界面语言选择，以 `zh` 开头时使用简体中文，其余语言使用英文。
- 扩展手动语言偏好保存到 `chrome.storage.local` 的 `interfaceLanguage`。
- 官网中文路径固定为 `/` 与 `/privacy/`，英文路径固定为 `/en/` 与 `/en/privacy/`。
- `README.md` 使用英文，`README.zh-CN.md` 使用简体中文。
- 商店发布文档和验收清单继续使用中文，只同步当前版本和发布资源事实。
- 所有 Markdown 代码块都声明代码语言并添加 `{.line-numbers}`。
- 所有 commit 消息使用简体中文，格式为 `<类型>: <简短描述>`。

---

### Task 1: 扩展语言核心与英文导出

**Files:**
- Create: `src/core/i18n.js`
- Create: `src/core/extension-language.js`
- Create: `tests/i18n.test.js`
- Modify: `src/core/note-format.js`
- Modify: `tests/note-format.test.js`
- Modify: `src/offscreen.js`
- Modify: `src/background.js`

**Interfaces:**
- Produces: `normalizeLanguage(value) -> "zh_CN" | "en" | null`。
- Produces: `resolveLanguage(preference, uiLanguage) -> "zh_CN" | "en"`。
- Produces: `translate(language, key, variables = {}) -> string`。
- Produces: `readInterfaceLanguage(storageLocal, uiLanguage) -> Promise<"zh_CN" | "en">`。
- Produces: `writeInterfaceLanguage(storageLocal, language) -> Promise<void>`。
- Changes: `buildMarkdown(session, entries, { language = "zh_CN" } = {}) -> string`。
- Changes: `EXPORT_SESSION` 消息携带 `language`，后台透传给隐藏页。

- [x] **Step 1: Write the failing language-core tests**

在 `tests/i18n.test.js` 写入独立期望值，验证自动选择、显式偏好、变量替换和缺失消息键。

```javascript {.line-numbers}
test("界面语言选择支持浏览器默认与显式偏好", () => {
  assert.equal(resolveLanguage(undefined, "zh-TW"), "zh_CN");
  assert.equal(resolveLanguage(undefined, "en-US"), "en");
  assert.equal(resolveLanguage("en", "zh-CN"), "en");
  assert.equal(resolveLanguage("invalid", "zh-CN"), "zh_CN");
});

test("英文消息替换变量并暴露缺失键", () => {
  assert.equal(translate("en", "exportComplete", { count: 3 }), "Exported 3 notes to ZIP");
  assert.equal(translate("en", "missingKey"), "missingKey");
});
```

- [x] **Step 2: Run the language-core test and verify RED**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/i18n.test.js
```

预期：因 `src/core/i18n.js` 尚不存在而失败。

- [x] **Step 3: Implement the bilingual message catalog and storage adapter**

`src/core/i18n.js` 提供固定语言集合、语言规范化、自动语言选择和 `{variable}` 替换。消息目录覆盖侧栏静态标签、笔记卡片、权限状态、录音、Whisper、历史确认、内容页浮层、授权页、导出 Markdown 和可见失败提示。

`src/core/extension-language.js` 只负责 `interfaceLanguage` 的读取与写入；无效值交给 `resolveLanguage` 回退。

- [x] **Step 4: Add a failing English Markdown export test**

```javascript {.line-numbers}
test("英文导出翻译固定标签并保留用户内容", () => {
  const markdown = buildMarkdown(
    { title: "课程标题", canonicalUrl: "https://example.com", platform: "youtube" },
    [{
      seconds: 1,
      jumpUrl: "https://example.com?t=1",
      body: "用户笔记",
      subtitleContext: "字幕原文",
      audioFilename: "audio/001.webm",
      warnings: [],
    }],
    { language: "en" },
  );
  assert.match(markdown, /- Platform: youtube/);
  assert.match(markdown, /- Original URL: \[Open video\]/);
  assert.match(markdown, /\[Original recording\]/);
  assert.match(markdown, /### Lead-in subtitles/);
  assert.match(markdown, /用户笔记/);
  assert.match(markdown, /字幕原文/);
});
```

- [x] **Step 5: Run the Markdown test and verify RED**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/note-format.test.js
```

预期：英文调用仍生成中文固定标签，新增测试失败。

- [x] **Step 6: Localize Markdown and carry language through export**

修改 `buildMarkdown` 使用消息键生成平台、原始网址、截图、录音、转写摘要与前置字幕标题。侧栏发送 `EXPORT_SESSION` 时携带当前语言；后台和隐藏页透传该值，隐藏页同时用语言对应的 ZIP 后缀和缺失资产告警。

- [x] **Step 7: Run focused tests and verify GREEN**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/i18n.test.js tests/note-format.test.js
```

预期：语言核心与导出测试全部通过。

### Task 2: 扩展页面与 Manifest 本地化

**Files:**
- Create: `_locales/en/messages.json`
- Create: `tests/extension-localization.test.js`
- Modify: `manifest.json`
- Modify: `_locales/zh_CN/messages.json`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.css`
- Modify: `src/sidepanel.js`
- Modify: `src/microphone-permission.html`
- Modify: `src/microphone-permission.js`
- Modify: `src/content.js`
- Modify: `scripts/build-extension.mjs`
- Modify: `tests/manifest.test.js`
- Modify: `tests/release-package.test.js`

**Interfaces:**
- Consumes: Task 1 的 `translate`、`readInterfaceLanguage` 和 `writeInterfaceLanguage`。
- Produces: 侧栏中的 `[data-interface-language]` 两个切换按钮。
- Produces: `_locales/en/messages.json` 中的 `extensionName`、`extensionDescription` 和 `actionTitle`。
- Changes: Manifest `action.default_title` 使用 `__MSG_actionTitle__`。

- [x] **Step 1: Write failing extension localization tests**

测试读取英文 Manifest 语言包并验证构建产物包含它；测试语言存储适配层读写真实 fake storage；测试侧栏和麦克风页构建后保留语言切换标记与本地脚本引用。

```javascript {.line-numbers}
test("英文 Manifest 语言包提供产品元数据", async () => {
  assert.equal(enMessages.extensionName.message, "Video Notes");
  assert.match(enMessages.extensionDescription.message, /YouTube and Bilibili/);
  assert.equal(enMessages.actionTitle.message, "Open Video Notes");
});

test("发布构建包含两种 Manifest 语言包", async () => {
  await access(new URL("../dist/_locales/zh_CN/messages.json", import.meta.url));
  await access(new URL("../dist/_locales/en/messages.json", import.meta.url));
});
```

- [x] **Step 2: Run the extension localization tests and verify RED**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/extension-localization.test.js tests/manifest.test.js tests/release-package.test.js
```

预期：英文语言包和语言切换入口缺失，测试失败。

- [x] **Step 3: Add Manifest English metadata and language controls**

新增英文语言包，为中文语言包补充 `actionTitle`，将 Manifest 工具栏标题改为消息引用。侧栏标题区域增加 `中文 / EN` 按钮组，CSS 保证 320px 宽度下仍可使用。

- [x] **Step 4: Apply translations before sidepanel initialization**

侧栏启动时先读取 `interfaceLanguage`，创建当前翻译函数，设置 `<html lang>`，再更新所有带本地化标记的静态节点。切换按钮写入偏好后重新加载页面。动态笔记卡片、权限说明、Whisper 状态、确认框、Toast、快捷键、日期格式和导出成功提示全部改用消息键。

- [x] **Step 5: Localize the microphone permission page and content overlay**

授权页启动时读取相同偏好并翻译静态与动态状态。内容脚本读取相同偏好并监听变更，翻译全屏录音浮层、快捷键错误前缀与录音失败提示。

- [x] **Step 6: Build and run focused tests to verify GREEN**

```bash {.line-numbers}
npm run build
node --test --test-concurrency=1 tests/extension-localization.test.js tests/manifest.test.js tests/release-package.test.js tests/sidepanel-history-ui.test.js tests/sidepanel-note-sort.test.js
```

预期：本地化、Manifest、发布包和现有侧栏行为测试全部通过。

### Task 3: 双语官网、README 与英文截图

**Files:**
- Create: `docs/language.js`
- Create: `docs/en/index.html`
- Create: `docs/en/privacy/index.html`
- Create: `README.zh-CN.md`
- Create: `store-assets/edge/screenshot-1-note-en.svg`
- Create: `store-assets/edge/screenshot-1-note-en.png`
- Create: `docs/assets/screenshot-1-note-en.png`
- Modify: `docs/index.html`
- Modify: `docs/privacy/index.html`
- Modify: `docs/styles.css`
- Modify: `README.md`
- Modify: `tests/site.test.js`
- Modify: `tests/store-assets.test.js`

**Interfaces:**
- Produces: `docs/language.js` 读取 `videoNotesLanguage`，接受 `zh_CN | en`，按当前页面的 `data-language-peer` 导航。
- Produces: 英文主页 `/en/` 与英文隐私页 `/en/privacy/`。
- Produces: 英文产品截图 `store-assets/edge/screenshot-1-note-en.png`，尺寸 `1280 × 800`。

- [x] **Step 1: Write failing site and asset tests**

```javascript {.line-numbers}
test("官网提供可切换的中英文主页与隐私页", async () => {
  const [zhHome, enHome, zhPrivacy, enPrivacy] = await Promise.all([
    read("docs/index.html"),
    read("docs/en/index.html"),
    read("docs/privacy/index.html"),
    read("docs/en/privacy/index.html"),
  ]);
  assert.match(zhHome, /data-language="en"/);
  assert.match(enHome, /<html lang="en">/);
  assert.match(enHome, /Turn video lessons into notes you can use/);
  assert.match(enPrivacy, /Connection metadata/);
  assert.match(enPrivacy, /Delete/);
  assert.match(zhPrivacy, /data-language="en"/);
});
```

在 `tests/store-assets.test.js` 将 `screenshot-1-note-en.png` 的预期尺寸设为 `1280 × 800`，并验证对应 SVG 不包含外部资源。

- [x] **Step 2: Run site and asset tests and verify RED**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/site.test.js tests/store-assets.test.js
```

预期：英文页面、语言脚本与英文截图缺失，测试失败。

- [x] **Step 3: Implement static language routing**

四个页面声明当前语言、对应语言路径和 `language.js`。脚本在没有偏好时按 `navigator.languages` 选择，在语言链接点击时保存偏好；存储失败时吞掉存储异常并继续普通导航。中文页面保留现有中文正文，英文页面使用独立英文正文。

- [x] **Step 4: Create English homepage and privacy policy**

英文主页覆盖使用流程、功能、本地优先、安装、支持范围和联系入口。英文隐私页逐项覆盖处理信息、IndexedDB、Cache Storage、Hugging Face 连接元数据、权限、麦克风、截图、保留、删除、更新和联系渠道。两页所有相对链接按 `/en/` 层级校正。

- [x] **Step 5: Create bilingual README files**

复制当前中文 README 到 `README.zh-CN.md` 并增加语言链接；将 `README.md` 重写为英文，保持安装、使用、联网范围、本地开发、支持、安全和许可事实一致。英文 README 引用英文截图，中文 README 引用中文截图。

- [x] **Step 6: Create and render the English screenshot**

复制 `screenshot-1-note.svg` 为英文源文件，只替换产品界面和示例课程文案，维持尺寸、颜色和布局。运行素材脚本生成 PNG，并把同一 PNG 放入 `docs/assets/` 供 GitHub Pages 使用。

```bash {.line-numbers}
npm run build:store-assets
```

- [x] **Step 7: Run site and asset tests and verify GREEN**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/site.test.js tests/store-assets.test.js
```

预期：网站与素材测试全部通过。

### Task 4: 版本同步与发布验证

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/manifest.test.js`
- Modify: `tests/release-package.test.js`
- Modify: `tests/site.test.js`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/index.html`
- Modify: `docs/en/index.html`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/STORE_LISTING.md`

**Interfaces:**
- Consumes: Tasks 1–3 的双语扩展、官网、README 和截图。
- Produces: 版本一致的 `1.0.3` 构建目录和 `video-notes-edge-1.0.3.zip` 发布包。

- [x] **Step 1: Update version expectations and verify RED**

把版本测试、发布包名和官网下载地址预期先改为 `1.0.3`。

```bash {.line-numbers}
node --test --test-concurrency=1 tests/manifest.test.js tests/release-package.test.js tests/site.test.js
```

预期：旧版元数据和下载链接导致失败。

- [x] **Step 2: Synchronize release metadata and current documentation**

把 Manifest、package 元数据、锁文件根包版本、双语 README、双语官网、验收清单和商店说明中的当前版本统一改为 `1.0.3`。验收清单自动验证项更新为本轮实际测试数量与新发布包名；历史人工烟测版本保持原记录。

- [x] **Step 3: Run complete automated verification**

```bash {.line-numbers}
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-1.0.3.zip
shasum -a 256 -c artifacts/video-notes-edge-1.0.3.zip.sha256
git diff --check
```

预期：测试零失败；构建、打包、ZIP 完整性、摘要校验与空白检查退出码均为 0。

- [x] **Step 4: Inspect scope and commit the implementation**

确认所有改动均可追溯到英文本地化、英文内容、英文截图、测试或 `1.0.3` 版本同步后提交。

```bash {.line-numbers}
git add _locales src tests scripts manifest.json package.json package-lock.json README.md README.zh-CN.md docs store-assets/edge/screenshot-1-note-en.svg store-assets/edge/screenshot-1-note-en.png
git commit -m "新增: 添加中英文体验并升级至 1.0.3"
```

## Self-Review

- Spec coverage: 扩展自动语言、手动切换、偏好保存、Manifest 英文、授权页、运行时提示、英文导出、双语官网、英文隐私政策、双语 README、英文截图与 `1.0.3` 版本同步均有对应任务。
- Placeholder scan: 计划没有待定实现、占位符或引用未定义接口。
- Type consistency: `zh_CN | en` 在语言核心、存储、页面、导出请求和网站偏好中保持一致；`buildMarkdown` 的第三个参数只增加可选配置，不破坏现有调用。
