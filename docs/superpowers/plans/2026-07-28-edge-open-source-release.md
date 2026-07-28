# 视频笔记 Edge 开源发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将视频笔记发布为公开的 Edge 扩展项目，提供 GitHub Pages 主页、GitHub Release、完整商店资料、Partner Center 首次提交和可复用发布 Skill。

**Architecture:** 现有扩展仓库继续作为唯一源码仓库，并通过 `docs/` 发布静态 GitHub Pages。发布配置、站点、商店素材和发布审计均进入版本控制；GitHub 与 Partner Center 写操作只在本地验证通过后执行。个人 Skill 独立安装到 Codex skills 目录，通过引用文档区分首次上架与后续更新。

**Tech Stack:** Microsoft Edge Manifest V3、Node.js 22、node:test、静态 HTML/CSS、SVG/PNG、GitHub CLI、GitHub Pages、Microsoft Partner Center、Python 3 标准库。

## Global Constraints

- 本轮只发布 Microsoft Edge Add-ons，不准备 Chrome Web Store。
- 公开仓库固定为 `IronUnicorn66/video-notes`，默认分支为 `main`，许可证为 MIT。
- 首次公开版本固定为 `0.3.0`，Release 标签为 `v0.3.0`。
- 主页固定为 `https://ironunicorn66.github.io/video-notes/`，隐私政策固定为 `https://ironunicorn66.github.io/video-notes/privacy/`。
- 不增加账户、云同步、分析统计、广告、远程转写或远程可执行代码。
- 商店截图不得出现真实账号、个人笔记、浏览器标签或第三方品牌 Logo。
- 所有 Markdown 代码块必须指定代码语言并带 `{.line-numbers}`。
- GitHub 和 Partner Center 凭据只能来自系统登录态、钥匙串或环境变量，禁止写入仓库和日志。

---

### Task 1: 发布 Manifest 与简体中文本地化

**Files:**
- Modify: `manifest.json`
- Create: `_locales/zh_CN/messages.json`
- Modify: `tests/manifest.test.js`

**Interfaces:**
- Consumes: 当前 `manifest.json` 的中文名称、说明和 `0.3.0` 版本。
- Produces: `__MSG_extensionName__`、`__MSG_extensionDescription__`、`default_locale: zh_CN` 和公开主页 URL。

- [ ] **Step 1: 写失败测试**

在 `tests/manifest.test.js` 增加断言：

```javascript {.line-numbers}
assert.equal(manifest.default_locale, "zh_CN");
assert.equal(manifest.name, "__MSG_extensionName__");
assert.equal(manifest.description, "__MSG_extensionDescription__");
assert.equal(manifest.homepage_url, "https://ironunicorn66.github.io/video-notes/");
assert.equal(messages.extensionName.message, "视频笔记");
```

- [ ] **Step 2: 验证测试因缺少本地化失败**

运行：

```bash {.line-numbers}
node --test tests/manifest.test.js
```

预期：本地化字段或消息文件断言失败。

- [ ] **Step 3: 最小实现发布字段**

把 Manifest 名称和说明替换为消息占位符，增加 `default_locale` 与 `homepage_url`。创建消息文件：

```json {.line-numbers}
{
  "extensionName": { "message": "视频笔记" },
  "extensionDescription": {
    "message": "在 YouTube 和哔哩哔哩课程中用文字或按住说话快速标记，导出带截图、字幕和录音的 Markdown。"
  }
}
```

- [ ] **Step 4: 验证测试与构建**

运行：

```bash {.line-numbers}
node --test tests/manifest.test.js
npm run build
```

预期：两条命令退出码均为 0，`dist/_locales/zh_CN/messages.json` 存在。

- [ ] **Step 5: 提交**

```bash {.line-numbers}
git add manifest.json _locales/zh_CN/messages.json tests/manifest.test.js
git commit -m "更新: 补齐 Edge 发布本地化配置"
```

### Task 2: 公开仓库文档与商店表单资料

**Files:**
- Create: `LICENSE`
- Create: `SECURITY.md`
- Modify: `README.md`
- Modify: `docs/STORE_LISTING.md`
- Modify: `docs/PRIVACY.md`
- Modify: `tests/manifest.test.js`

**Interfaces:**
- Consumes: Task 1 的主页 URL、现有权限、模型配置和 `0.3.0` 版本。
- Produces: 可公开审阅的项目首页、MIT 授权、漏洞报告入口和 Partner Center 字段源文档。

- [ ] **Step 1: 写文档一致性失败测试**

增加测试，要求 README、商店文档和隐私文档都包含三个公开 URL、当前版本、本地数据说明，以及商店文档包含单一用途和全部权限名：

```javascript {.line-numbers}
for (const text of [readme, listing, privacy]) {
  assert.match(text, /ironunicorn66\.github\.io\/video-notes/);
  assert.match(text, /github\.com\/IronUnicorn66\/video-notes\/issues/);
}
for (const permission of manifest.permissions) {
  assert.match(listing, new RegExp(`\\b${permission}\\b`));
}
```

- [ ] **Step 2: 验证测试失败**

```bash {.line-numbers}
node --test tests/manifest.test.js
```

预期：公开 URL、许可证或权限披露断言失败。

- [ ] **Step 3: 重写公开文档**

README 采用“定位、演示、功能、安装、使用、隐私、开发、贡献与支持”结构。`docs/STORE_LISTING.md` 明确填写：公开、全部市场、生产力、无成熟内容、单一用途、每项权限理由、静态模型权重、无远程代码、数据类型、审核步骤和搜索词。`docs/PRIVACY.md` 增加公开支持入口、政策日期和删除方式。添加 MIT License 与 GitHub Security Advisory 报告指引。

- [ ] **Step 4: 验证文档一致性**

```bash {.line-numbers}
node --test tests/manifest.test.js
rg -n "/Users/|TBD|TODO|测试账号|私钥|API Key" README.md LICENSE SECURITY.md docs/STORE_LISTING.md docs/PRIVACY.md
git diff --check
```

预期：测试通过；敏感内容扫描只允许文档中用于禁止泄露的 `API Key` 描述。

- [ ] **Step 5: 提交**

```bash {.line-numbers}
git add LICENSE SECURITY.md README.md docs/STORE_LISTING.md docs/PRIVACY.md tests/manifest.test.js
git commit -m "更新: 完善开源与 Edge 上架资料"
```

### Task 3: GitHub Pages 产品主页与隐私政策

**Files:**
- Create: `docs/index.html`
- Create: `docs/styles.css`
- Create: `docs/privacy/index.html`
- Create: `docs/.nojekyll`
- Create: `tests/site.test.js`

**Interfaces:**
- Consumes: Task 2 的公开文案、URL 和隐私声明。
- Produces: 可从 `docs/` 直接发布的静态首页和隐私政策。

- [ ] **Step 1: 写站点失败测试**

```javascript {.line-numbers}
test("主页提供产品流程、下载、隐私与支持入口", async () => {
  const html = await read("docs/index.html");
  assert.match(html, /视频笔记/);
  assert.match(html, /releases\/download\/v0\.3\.0\/video-notes-edge-0\.3\.0\.zip/);
  assert.match(html, /privacy\//);
  assert.match(html, /github\.com\/IronUnicorn66\/video-notes\/issues/);
});
```

同时断言页面没有第三方脚本、字体和分析代码，CSS 包含窄屏布局与 `prefers-reduced-motion`。

- [ ] **Step 2: 验证测试因页面缺失失败**

```bash {.line-numbers}
node --test tests/site.test.js
```

预期：读取 `docs/index.html` 失败。

- [ ] **Step 3: 实现静态站点**

首页包含导航、主视觉、四步使用流程、功能卡片、本地隐私说明、GitHub Release 安装步骤和页脚。隐私页逐项说明处理的数据、存储、模型下载、权限、删除、共享和联系方式。所有链接使用 HTTPS，所有图片提供替代文本。

- [ ] **Step 4: 验证站点并人工查看**

```bash {.line-numbers}
node --test tests/site.test.js
```

使用本地静态服务器在 1440 × 900 与 390 × 844 视口检查布局、对比度、键盘焦点和链接。

- [ ] **Step 5: 提交**

```bash {.line-numbers}
git add docs/index.html docs/styles.css docs/privacy/index.html docs/.nojekyll tests/site.test.js
git commit -m "新增: 提供视频笔记产品主页"
```

### Task 4: Edge 商店图片与自动校验

**Files:**
- Create: `store-assets/edge/logo-300.svg`
- Create: `store-assets/edge/logo-300.png`
- Create: `store-assets/edge/promo-440x280.svg`
- Create: `store-assets/edge/promo-440x280.png`
- Create: `store-assets/edge/screenshot-1-note.svg`
- Create: `store-assets/edge/screenshot-1-note.png`
- Create: `store-assets/edge/screenshot-2-context.svg`
- Create: `store-assets/edge/screenshot-2-context.png`
- Create: `store-assets/edge/screenshot-3-export.svg`
- Create: `store-assets/edge/screenshot-3-export.png`
- Create: `tests/store-assets.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: 现有 `assets/icon.svg`、Task 2 商店文案和当前侧栏视觉。
- Produces: Partner Center 可直接上传的 PNG 与可维护 SVG 源文件。

- [ ] **Step 1: 写素材尺寸失败测试**

```javascript {.line-numbers}
assert.deepEqual(await pngSize("store-assets/edge/logo-300.png"), [300, 300]);
assert.deepEqual(await pngSize("store-assets/edge/promo-440x280.png"), [440, 280]);
for (const file of screenshots) {
  assert.deepEqual(await pngSize(file), [1280, 800]);
}
```

- [ ] **Step 2: 验证测试因素材缺失失败**

```bash {.line-numbers}
node --test tests/store-assets.test.js
```

预期：PNG 文件不存在。

- [ ] **Step 3: 创建 SVG 并渲染 PNG**

素材沿用现有深绿、薄荷绿和暖白色，截图复刻侧栏结构并使用中性课程占位画面。安装 `sharp` 为固定开发依赖，仅用于素材渲染，不进入扩展发布包。

- [ ] **Step 4: 验证尺寸、文案和视觉**

```bash {.line-numbers}
node --test tests/store-assets.test.js
file store-assets/edge/*.png
```

逐张检查 PNG，确认无裁切、模糊、个人信息和第三方 Logo。

- [ ] **Step 5: 提交**

```bash {.line-numbers}
git add store-assets/edge tests/store-assets.test.js package.json package-lock.json
git commit -m "新增: 制作 Edge 商店发布素材"
```

### Task 5: 发布包审计与 0.3.0 Release 准备

**Files:**
- Modify: `tests/manifest.test.js`
- Modify: `README.md`
- Generate: `artifacts/video-notes-edge-0.3.0.zip`
- Generate: `artifacts/video-notes-edge-0.3.0.zip.sha256`

**Interfaces:**
- Consumes: Tasks 1–4 的发布配置、文档和素材。
- Produces: 可加载、可上传、可复核的 0.3.0 ZIP 与摘要。

- [ ] **Step 1: 增加发布包边界测试**

测试 ZIP 根目录含 `manifest.json` 和 `_locales/zh_CN/messages.json`，同时排除 `tests/`、`docs/`、`store-assets/`、`.git/` 和模型权重。

- [ ] **Step 2: 验证发布包测试**

```bash {.line-numbers}
npm test
```

预期：新测试在旧包或缺少本地化时失败。

- [ ] **Step 3: 生成发布包和摘要**

```bash {.line-numbers}
npm run package
shasum -a 256 artifacts/video-notes-edge-0.3.0.zip
```

将摘要写入同名 `.sha256` 文件，并在 README 的验证说明中记录下载包校验方式。

- [ ] **Step 4: 完整验证**

```bash {.line-numbers}
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-0.3.0.zip
unzip -l artifacts/video-notes-edge-0.3.0.zip
git diff --check
```

预期：全部退出码为 0，ZIP 清单符合边界。

- [ ] **Step 5: 提交源码变更**

```bash {.line-numbers}
git add README.md tests/manifest.test.js
git commit -m "更新: 校验 Edge 发布包边界"
```

### Task 6: 创建公开 GitHub 仓库、Pages 与 Release

**Files:**
- External: `https://github.com/IronUnicorn66/video-notes`
- External: GitHub Pages settings
- External: GitHub Release `v0.3.0`

**Interfaces:**
- Consumes: Task 5 的干净 `main`、ZIP、摘要、主页与许可证。
- Produces: 公开源码、Issues、Pages 和可下载 Release。

- [ ] **Step 1: 扫描公开边界**

```bash {.line-numbers}
git status --short
git log --all -p
git grep -n -I -E "gho_|github_pat_|AKIA|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|/Users/psh|@gmail\.com"
```

人工区分固定扩展公钥与私钥，确保没有令牌、Cookie、录音、个人笔记或临时截图进入历史。

- [ ] **Step 2: 创建并推送公开仓库**

```bash {.line-numbers}
gh repo create IronUnicorn66/video-notes --public --source=. --remote=origin --push --description "在 YouTube 和哔哩哔哩课程中快速记录带截图、字幕和本地语音转写的视频笔记"
```

- [ ] **Step 3: 启用 GitHub Pages**

使用 GitHub API 把 Pages 构建源设为 `main` 分支 `/docs`，轮询部署状态直到返回公开 URL。

- [ ] **Step 4: 创建 Release**

```bash {.line-numbers}
gh release create v0.3.0 artifacts/video-notes-edge-0.3.0.zip artifacts/video-notes-edge-0.3.0.zip.sha256 --repo IronUnicorn66/video-notes --title "视频笔记 0.3.0" --notes-file /tmp/video-notes-v0.3.0-release-notes.md
```

- [ ] **Step 5: 验证公开资源**

确认仓库、Issues、Release 下载、首页和隐私政策无需登录并返回 HTTP 200；在 README 中打开图片和链接。

### Task 7: Partner Center 首次提交

**Files:**
- External: Microsoft Partner Center Edge workspace
- Consume: `artifacts/video-notes-edge-0.3.0.zip`
- Consume: `store-assets/edge/*.png`
- Consume: `docs/STORE_LISTING.md`

**Interfaces:**
- Consumes: Task 6 的公开 URL 和 Task 5 的发布包。
- Produces: Partner Center 扩展条目、正式产品 ID 和认证提交状态。

- [ ] **Step 1: 创建扩展并上传包**

在 Partner Center Edge 工作区点击“Create new extension”，上传 ZIP，等待包验证完成。记录所有警告和错误，任何包内容修复都先回到源码、测试和新提交。

- [ ] **Step 2: 填写可用性和属性**

选择 Public、全部市场、Productivity、无成熟内容；填写 GitHub Pages 主页和 GitHub Issues 支持入口。

- [ ] **Step 3: 填写隐私页面**

从 `docs/STORE_LISTING.md` 逐项填写单一用途、每项权限理由、无远程可执行代码、实际数据处理和公开隐私政策。对静态 Whisper 权重说明固定来源、固定摘要、本地缓存和不执行。

- [ ] **Step 4: 填写简体中文商店页**

上传 300 × 300 图标、440 × 280 宣传图和三张 1280 × 800 截图；填写 250–10,000 字符完整说明和不超过七个搜索词。

- [ ] **Step 5: 填写审核说明并提交**

提供无需账号的 YouTube/哔哩哔哩测试步骤、截图可选权限、本地模型下载和导出验证方式。提交认证并记录产品 ID、提交时间、状态和可复核截图。

### Task 8: 创建并验证 `publish-edge-extension` Skill

**Files:**
- Create: `/Users/psh/.codex/skills/publish-edge-extension/SKILL.md`
- Create: `/Users/psh/.codex/skills/publish-edge-extension/references/first-release.md`
- Create: `/Users/psh/.codex/skills/publish-edge-extension/references/update-release.md`
- Create: `/Users/psh/.codex/skills/publish-edge-extension/references/store-field-map.md`
- Create: `/Users/psh/.codex/skills/publish-edge-extension/scripts/audit_edge_release.py`

**Interfaces:**
- Consumes: 本次 Tasks 1–7 的实际流程和 Microsoft 官方 Edge 发布文档。
- Produces: 可发现、可验证、同时覆盖首次上架与后续更新的个人 Skill。

- [ ] **Step 1: 运行无 Skill 基线压力场景**

向测试代理提供一个包含宽权限、缺少隐私政策、版本未递增和 ZIP 套目录的 Edge 扩展发布请求，不提供新 Skill。记录代理遗漏的检查、误填项和提前发布行为。

- [ ] **Step 2: 使用官方初始化器创建 Skill**

```bash {.line-numbers}
python3 /Users/psh/.codex/skills/.system/skill-creator/scripts/init_skill.py publish-edge-extension --path /Users/psh/.codex/skills --resources scripts,references
```

- [ ] **Step 3: 实现最小 Skill 和审计脚本**

`SKILL.md` 只保留触发条件、首次/更新路由、发布门禁和密钥边界；详细表单、API 和字段映射放入三份 reference。审计脚本使用 Python 标准库读取仓库、Manifest、ZIP 和 PNG IHDR，并支持：

```bash {.line-numbers}
python3 scripts/audit_edge_release.py --repo /absolute/project --zip /absolute/release.zip --assets /absolute/store-assets/edge
```

- [ ] **Step 4: 运行 Skill 压力场景**

给测试代理同一发布请求并显式提供 Skill，验证它会区分首次发布与更新、拒绝泄露 API Key、检查版本与 ZIP 根目录、核对权限和隐私、在首次发布时走 Partner Center、在更新时才考虑 API v1.1。

- [ ] **Step 5: 校验 Skill 与实战回放**

```bash {.line-numbers}
python3 /Users/psh/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/psh/.codex/skills/publish-edge-extension
python3 /Users/psh/.codex/skills/publish-edge-extension/scripts/audit_edge_release.py --repo /Users/psh/codes/video_notes --zip /Users/psh/codes/video_notes/artifacts/video-notes-edge-0.3.0.zip --assets /Users/psh/codes/video_notes/store-assets/edge
```

预期：两个命令均退出 0，审计输出列出版本、包边界、素材和公开 URL 的通过状态。

## 最终验证

按顺序重新运行扩展测试、构建、打包、站点测试、素材测试、Skill 校验和 Skill 实战审计。核对 Git 状态、公开 GitHub 资源和 Partner Center 提交状态，记录仍需等待 Microsoft 完成的认证步骤。
