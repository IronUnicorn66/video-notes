# 视频笔记 Edge 开源发布设计

日期：2026-07-28

## 目标

把“视频笔记”整理为可公开安装、审阅和持续更新的 Microsoft Edge 扩展，并沉淀一套可复用的 Edge 扩展首次上架与后续更新 Skill。

本轮只覆盖 Microsoft Edge Add-ons，不准备 Chrome Web Store 版本。

## 交付边界

工作拆成四个按顺序衔接的交付物：

1. 公开源码仓库与 GitHub Release。
2. GitHub Pages 产品主页、隐私政策和支持入口。
3. Microsoft Edge Partner Center 首次上架资料与提交。
4. 面向其他 Edge 扩展项目的发布 Skill。

每个交付物可以独立验证。Partner Center 必须依赖前三项提供的公开网址和发布包。

## 公开仓库

- 仓库：`IronUnicorn66/video-notes`。
- 可见性：公开。
- 默认分支：`main`。
- 许可证：MIT。
- Issues 作为公开支持入口。
- 保留当前 Git 历史；公开前扫描当前树和历史中的凭据、私钥、个人路径和调试数据。
- 发布包放入 GitHub Release，不把 `dist` 或临时构建文件提交到源码树。
- 首个公开 Release 使用现有产品版本 `v0.3.0`，附带 `video-notes-edge-0.3.0.zip` 和 SHA-256。

README 面向最终用户，保留产品简介、核心能力、安装、使用、隐私、开发验证和文档入口。详细的模型摘要、权限解释与审核内容继续保存在 `docs/`。

## GitHub Pages 主页

主页与源码放在同一仓库，通过 `main` 分支的 `docs/` 目录发布到：

- 首页：`https://ironunicorn66.github.io/video-notes/`
- 隐私政策：`https://ironunicorn66.github.io/video-notes/privacy/`
- 支持：`https://github.com/IronUnicorn66/video-notes/issues`

页面使用静态 HTML、CSS 和本地图片，不加载第三方脚本、字体或分析代码。站点包含：

1. 产品定位和主要安装入口。
2. 文字标记、截图、前置字幕、本地语音转写和 ZIP 导出流程。
3. YouTube 与哔哩哔哩支持范围。
4. 本地数据、模型下载与权限说明。
5. GitHub Release 测试版安装步骤。
6. 隐私政策、源码、Issues 和 Edge 商店入口。

商店审核期间主页提供 GitHub Release 测试版；取得 Edge 商店页面后，将主按钮切换为商店安装，GitHub Release 保留为开发者安装方式。

## 品牌与商店素材

沿用现有“视频笔记”名称和绿色系图标，不引入第二套品牌。新增素材：

- 300 × 300 PNG 商店图标。
- 440 × 280 PNG 小型宣传图。
- 三张 1280 × 800 PNG 功能截图。

截图使用产品界面示意和中性课程内容，不展示真实账号、浏览器标签、个人笔记或第三方品牌 Logo。三张截图依次表达：

1. 看视频时快速写下带时点的笔记。
2. 自动保留截图和标记前字幕。
3. 本地语音转写并导出 Markdown ZIP。

SVG 作为可维护源文件，PNG 为商店上传产物。自动测试校验尺寸、文件存在性和文案边界。

## 扩展发布配置

首次提交继续使用版本 `0.3.0`。发布准备补齐：

- `default_locale: zh_CN` 和 `_locales/zh_CN/messages.json`。
- `homepage_url` 指向 GitHub Pages 首页。
- Manifest、包元数据、发布文档和 ZIP 版本保持一致。
- 公开的隐私政策 URL 与支持 URL。
- 完整商店说明、单一用途、每项权限理由、远程代码声明、数据处理声明和审核步骤。

Edge 上架范围为公开、全部市场、生产力类别、无成熟内容。商店文案只描述可独立工作的“视频笔记”能力；与“网课声伴”的扩展间协作暂不作为首次上架卖点，避免正式商店 ID 尚未互相确认时产生误导。

本地 Whisper 的远程请求只下载固定 revision、固定尺寸并校验 SHA-256 的静态模型权重。JavaScript、Worker 和 WASM 全部包含在安装包中。商店隐私和远程代码表单必须明确区分静态模型数据与远程可执行代码。

## Partner Center 提交

首次发布通过 Partner Center 手动完成：

1. 创建新扩展并上传 ZIP。
2. 选择公开和全部市场。
3. 填写生产力类别、主页和支持入口。
4. 填写单一用途、权限理由、远程代码、数据使用和隐私政策。
5. 上传简体中文商店说明与图片。
6. 填写无需账号的审核步骤。
7. 解决表单或包验证错误后提交认证。

如果 Partner Center 分配的正式扩展 ID 与开发 ID 不同，记录正式 ID。该差异不阻塞视频笔记的核心功能；后续再更新两个扩展的互信白名单。

提交后的完成状态分为两级：

- 已提交审核：Partner Center 已接受完整表单并进入认证队列。
- 已上架：状态变为 `In the store`，公开商店页面可以访问。

本轮持续完成可立即执行的步骤；认证等待时间由 Microsoft 决定，不把等待审核结果描述为本地实现失败。

## 可复用发布 Skill

个人 Skill 名称为 `publish-edge-extension`，安装到 Codex 个人 skills 目录。触发范围包括：

- Edge 扩展第一次上架。
- 已上架扩展更新包、更新商店信息或重新提交审核。
- 生成上架清单、权限说明、隐私披露、素材和审核步骤。
- 检查 GitHub Release、主页、隐私政策与 Partner Center 内容是否一致。

Skill 采用渐进披露结构：

- `SKILL.md`：入口判断、风险边界、通用发布门禁和路由。
- `references/first-release.md`：首次 Partner Center 发布。
- `references/update-release.md`：手动更新与 Edge Update API v1.1。
- `references/store-field-map.md`：Manifest、代码行为、商店表单与公开政策的映射。
- `scripts/audit_edge_release.py`：检查版本、ZIP 根目录、Manifest、发布素材、公开 URL 和常见敏感文件。

首次发布保持人工提交，因为 Microsoft 官方要求先在 Partner Center 创建扩展。后续版本默认先生成并验证发布包；若项目已启用 Partner Center Publish API，则可使用 API v1.1 上传、轮询和发布。Client ID 与 API Key 只从环境变量读取，禁止写入仓库、Skill 或日志。

## 验证

- 扩展完整测试、构建、打包和 ZIP 完整性检查通过。
- ZIP 根目录直接包含 `manifest.json`，不包含测试、开发文档、Git 元数据或商店素材。
- 商店图片尺寸和格式符合 Edge 要求。
- 主页与隐私政策通过自动测试，并在桌面和窄屏下人工检查。
- GitHub 仓库公开可访问，Release 文件可下载，Issues 可打开。
- GitHub Pages 首页和隐私政策返回 HTTP 200。
- Partner Center 上传包校验通过，所有必填项完整，最终提交状态有截图或可复核记录。
- 发布 Skill 通过初始化校验、静态校验、无 Skill 基线测试和启用 Skill 后的压力场景测试。

## 非目标

- 本轮不发布 Chrome Web Store。
- 不增加账户、云同步、分析统计或远程转写。
- 不修改现有笔记功能和数据格式。
- 不等待 Microsoft 的人工认证结束后才交付本地成果。
