# 官网主页精简实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将中英文官网主页压缩为“问题、用法、价值”三段，并把桌面页面控制在 3 个视口以内。

**Architecture:** 继续使用两个静态 HTML 页面和共享 CSS，不增加脚本、依赖或图片。中英文页面采用相同的语义区、锚点和卡片结构；安装、隐私与支持信息合并到用法和价值区。

**Tech Stack:** HTML5、CSS、Node.js 内置测试运行器、GitHub Pages 静态站点。

## Global Constraints

- 桌面 1440 × 900 下页面高度不超过 2700 像素。
- 中英文页面的结构、链接、版本和支持范围保持一致。
- 不增加第三方脚本、字体、分析服务、图片或运行时依赖。
- 版本从 `1.0.3` 升级到 `1.0.4`；Manifest、包元数据、锁文件、发布测试和当前发布文档保持一致。
- Markdown 代码块必须声明语言并启用行号。
- Commit 消息使用简体中文，格式为 `<类型>: <简短描述>`。

---

### Task 1: 建立三段式主页契约并完成双语改造

**Files:**

- Modify: `tests/site.test.js`
- Modify: `docs/index.html`
- Modify: `docs/en/index.html`
- Modify: `docs/styles.css`

**Interfaces:**

- Consumes: 现有 `language.js` 语言选择、相对隐私链接和 GitHub Release 下载链接。
- Produces: `#problem`、`#how`、`#value`、`#install` 四个稳定锚点；两种语言各四个使用步骤和三个价值卡片。

- [ ] **Step 1: 写入会失败的结构测试**

将主页测试改为同时读取中英文 HTML，断言三个主题区按问题、用法、价值的顺序出现，安装入口位于用法区，旧的 `#features` 与 `.numbers` 不再出现，并保留下载、隐私、支持站点和语言脚本。

```javascript {.line-numbers}
for (const html of [zhHome, enHome]) {
  const problem = html.indexOf('id="problem"');
  const how = html.indexOf('id="how"');
  const value = html.indexOf('id="value"');
  assert.ok(problem >= 0 && problem < how && how < value);
  assert.match(html, /id="install"/);
  assert.doesNotMatch(html, /id="features"|class="numbers/);
}
```

- [ ] **Step 2: 运行站点测试并确认红灯**

```bash {.line-numbers}
node --test tests/site.test.js
```

预期：新结构测试因缺少 `#problem` 或 `#value` 失败。

- [ ] **Step 3: 重写中英文主页正文**

保留现有页头、品牌、产品界面视觉、下载按钮、隐私入口、语言切换和页脚。删除能力数字、详细功能区、本地数据流和独立支持区；将安装说明合并到四步用法区，将本地优先和支持站点合并到三张价值卡与结尾信任说明。

- [ ] **Step 4: 收敛共享样式**

删除只服务于已移除模块的样式，新增四步流程、紧凑安装条、三张价值卡和结尾行动区样式。保持现有配色、焦点态、减少动态效果和 720 像素窄屏规则。

- [ ] **Step 5: 运行站点测试并确认绿灯**

```bash {.line-numbers}
node --test tests/site.test.js tests/site-language.test.js
```

预期：站点结构、语言选择、静态资源和第三方资源约束全部通过。

---

### Task 2: 同步 1.0.4 版本与发布材料

**Files:**

- Modify: `tests/manifest.test.js`
- Modify: `tests/release-package.test.js`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/STORE_LISTING.md`
- Modify: `docs/index.html`
- Modify: `docs/en/index.html`

**Interfaces:**

- Consumes: `scripts/build-extension.mjs` 和 `scripts/package-extension.mjs` 的版本化输出命名。
- Produces: `video-notes-edge-1.0.4.zip`、对应 SHA-256 文件和指向 `v1.0.4` 的当前下载文案。

- [ ] **Step 1: 先把版本测试预期改为 1.0.4**

```javascript {.line-numbers}
assert.equal(manifest.version, "1.0.4");
const artifactName = 'video-notes-edge-1.0.4.zip';
assert.equal(packagedManifest.version, '1.0.4');
```

- [ ] **Step 2: 运行版本测试并确认红灯**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/manifest.test.js tests/release-package.test.js
```

预期：Manifest 仍为 `1.0.3`，发布包名或打包版本断言失败。

- [ ] **Step 3: 同步版本文件和当前发布文档**

将清单、包文件、锁文件根包版本、双语 README、双语官网、验收清单和商店上架资料中的当前版本改为 `1.0.4`。历史设计与实施计划保留原版本记录。

- [ ] **Step 4: 运行定向测试并确认绿灯**

```bash {.line-numbers}
node --test --test-concurrency=1 tests/site.test.js tests/manifest.test.js tests/release-package.test.js
```

预期：主页下载地址、版本一致性、构建清单、发布包内容和校验文件全部通过。

---

### Task 3: 完整验证、视觉检查与提交

**Files:**

- Verify: `docs/index.html`
- Verify: `docs/en/index.html`
- Verify: `docs/styles.css`
- Verify: `artifacts/video-notes-edge-1.0.4.zip`

**Interfaces:**

- Consumes: Task 1 的静态主页与 Task 2 的 1.0.4 发布元数据。
- Produces: 通过自动化和视觉验收的中英文官网与可核验发布包。

- [ ] **Step 1: 运行完整自动化测试、构建和打包**

```bash {.line-numbers}
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-1.0.4.zip
cd artifacts && shasum -a 256 -c video-notes-edge-1.0.4.zip.sha256
```

- [ ] **Step 2: 检查版本残留与差异质量**

确认非历史文件中没有 `1.0.3` 当前版本引用，运行 `git diff --check`，并检查改动只覆盖主页、测试、版本与当前发布文档。

- [ ] **Step 3: 在浏览器验证四种页面组合**

在 1440 × 900 和 390 × 844 视口分别检查中英文主页。桌面页面高度应不超过 2700 像素；四种组合均不得出现横向溢出、遮挡、缺图或控制台错误。

- [ ] **Step 4: 提交实现**

```bash {.line-numbers}
git add tests/site.test.js tests/manifest.test.js tests/release-package.test.js manifest.json package.json package-lock.json README.md README.zh-CN.md docs/ACCEPTANCE.md docs/STORE_LISTING.md docs/index.html docs/en/index.html docs/styles.css docs/superpowers/plans/2026-07-29-landing-page-simplification.md
git commit -m "优化: 精简双语官网主页并升级至 1.0.4"
```

## 计划自查

- Spec coverage：问题、用法、价值、双语一致、桌面长度、移动端、外部资源限制、版本同步、发布包和视觉验收均有对应步骤。
- Placeholder scan：每一步均提供了具体文件、断言、命令与预期结果。
- Interface consistency：四个锚点、三个价值卡片和 `1.0.4` 版本命名在任务间保持一致。
