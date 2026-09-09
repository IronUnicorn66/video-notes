<p align="center"><strong>简体中文</strong> · <a href="README.md">English</a></p>

<p align="center">
  <img src="assets/icon.svg" width="96" alt="视频笔记图标">
</p>

<h1 align="center">视频笔记</h1>

<p align="center">把视频课程整理成中文学习地图：一个保留原文、时间轴与个人批注的 AI skill，配套浏览器采集扩展。</p>

**先看清一节课讲了什么，再回到具体片段理解。** Video Notes 由 [video-notes skill](skills/video-notes/SKILL.md) 和桌面 Edge/Chrome 扩展配套组成：扩展保存课程原文、时间轴、截图和你的想法；skill 阅读导出，生成中文章节目录、摘要与有针对性的批注点评。输出为 Markdown，可在 Obsidian 中使用。

**采集课程 → 导出 ZIP → 调用 skill → 中文课程地图 + 学习笔记**

| 组件 | 负责什么 | 交付什么 |
| --- | --- | --- |
| video-notes skill | 完整阅读原文、按主题分章、回应你的问题 | 中文地图、可点击时间目录、批注点评、来源引用 |
| 浏览器扩展 | 看课时记笔记、截图、读取字幕与时间 | Markdown、附件、完整原文 JSON / SRT / Markdown（获取成功时） |

时间链接打开原视频的对应位置。全量字幕当前支持 YouTube；旧版 ZIP 和 Bilibili 批注仍可整理，缺少全量字幕时只整理局部材料。中文目录和摘要由运行 skill 的 AI 生成；浏览器本地翻译可继续用于看课。

## 开始使用配套 skill

需要支持本地 skill 与文件读写的 AI 客户端，以及 Python 3.10+。以下提供 Codex 的安装入口；skill 本身不捆绑模型、会员或 API 额度。

下载或克隆本仓库，在仓库根目录运行：

```bash {.line-numbers}
python3 scripts/install-video-notes-skill.py
```

安装器将 [skills/video-notes/](skills/video-notes/) 复制到 `$CODEX_HOME/skills/video-notes`；未设置 `CODEX_HOME` 时使用 `~/.codex/skills/video-notes`。如果已有同名 skill，先完整备份到同一根目录的 `skill-backups/`，并输出备份位置。后续更新仓库后可再次运行此命令。其他客户端可按自己的安装约定复制整个 skill 目录。

1. 安装下方的浏览器扩展，在课程页点击“导出 ZIP”。有全量原文时，没有批注也能导出。
2. 在 AI 客户端打开希望存放笔记的目录，安装后在新任务中调用：

   > 使用 $video-notes 导入最新视频笔记，生成中文课程地图，并详细回答我的批注问题。

3. 也可指定 ZIP 和输出位置，或仅要求生成地图：

   > 使用 $video-notes 整理这个课程 ZIP，输出到我的课程笔记目录。先完整阅读英文原文，生成中文章节、摘要和可点击时间目录，保留原文附件。

已有 Obsidian 笔记目录时沿用原目录；新项目默认输出到 `Video Notes/`。通常得到：

- **整理笔记.md**：你的批注、截图、课程上下文与 AI 点评。
- **课程地图.md**：中文章节与子主题、一句话摘要、跳转链接。
- **课程地图.json**：对应原字幕的章节范围和来源校验信息。
- **来源附件**：原文 JSON / SRT / Markdown、截图及旧版音频。

skill 会检查长课程字幕覆盖、章节遗漏和时间引用，保留人工内容；分章与解释仍需要 AI 自查。当前不支持把地图导回扩展，也不在扩展内登录或自动调用模型。扩展安装 ZIP 与 skill 分别安装，仓库包含两者的源码。

## 1.0.41 更新

- 仓库新增配套 video-notes skill、带备份的安装脚本，以及导出到课程地图的校验工具。
- 完整原文字幕逐条导出为 JSON、SRT 和 Markdown，保留毫秒起止时间与可点击视频链接。
- 支持无批注课程导出；没有完整字幕时明确记录缺口。
- 移除录音、按住说话、麦克风授权、Whisper 转写与模型下载；已有笔记和录音附件仍可查看、导出。

## 浏览器扩展能力

- 点击快速标记输入框时暂停视频，移开焦点后自动保存并续播。
- 可以使用浏览器原生侧栏，也可以点击“独立窗口”弹出可调整大小的独立界面；原视频暂时切到后台时，开始记笔记会自动重新激活它，以保证暂停和截图正确。
- 在视频页或笔记侧栏中直接使用无修饰的左右方向键前后跳转 5 秒、使用空格切换播放；文字输入区仍保留空格输入和光标移动。
- 每条笔记保存视频时点、播放器截图和可配置的标记前 5、10、20 或 30 秒字幕；当前 YouTube 完整字幕已加载时，优先复用本地完整段落，选中范围全部翻译后同时保存对应译文。
- 支持 YouTube、哔哩哔哩播放器实际渲染的原生字幕，以及沉浸式翻译呈现的双语字幕；哔哩哔哩还会尝试读取当前分 P 的原生字幕轨，但部分新版页面仍可能无法取得。
- 对已暴露原生字幕轨道的 YouTube 视频显示完整字幕、覆盖范围、按完整句调整边界的 5/10/20 条合并阅读、独立字号调节、原文/译文显示选择、时间跳转和播放器当前进度定位；译文逐段出现或切换显示模式时保持当前阅读段。
- 在本机缓存已加载的 YouTube 完整字幕、每个目标语言和合并档位下已完成的译文，以及侧栏整页和字幕列表的阅读位置；字幕进度按稳定阅读段而非仅按像素恢复，译文高度变化后重开仍停在离开处，“重试”仍会强制刷新字幕源。
- 使用语言切换左侧的 `+`、`−` 按钮，以 10% 为一档在 75%–200% 之间调整整个侧栏大小。
- 浏览器原生侧栏只在受支持的 YouTube 和哔哩哔哩视频标签启用，切到其他页面会自动隐藏；受 Edge 已知问题限制，返回此前打开过侧栏的课程标签后需要再次点击工具栏图标。
- 使用 Edge/Chrome 内置 Translator API 在本机按完整句段落翻译字幕；自动识别字幕语言，首版可选择简体中文、英语、日语、韩语或西班牙语作为目标语言，并提前下载当前语言对。
- 正序或倒序查看时间线，支持编辑、删除、清空、弯箭头撤销/反撤销，以及持久化的 10–24px 笔记字号调节。
- 导出 ZIP，包含 Markdown、截图和带时间分块的完整原文字幕（获取成功时）。

## 安装浏览器扩展

### Edge 商店

[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/cndejflmchbjejlflldlmfplcadnpjkj) 当前公开版本为 1.0.32。1.0.41 为本地待发布版本，尚未上传商店或 GitHub Release；下列下载地址在发布后可用。

### GitHub Release 测试版

[下载视频笔记 1.0.41 ZIP](https://github.com/IronUnicorn66/video-notes/releases/download/v1.0.41/video-notes-edge-1.0.41.zip)
· [SHA-256 校验文件](https://github.com/IronUnicorn66/video-notes/releases/download/v1.0.41/video-notes-edge-1.0.41.zip.sha256)

1. 下载 ZIP 并解压到固定目录。
2. 在 Edge 地址栏打开 `edge://extensions/`，或在 Chrome 打开 `chrome://extensions/`。
3. 开启“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择解压后的目录；该目录内应直接包含 `manifest.json`。

测试版需要手动更新。新版本发布后，请重新下载并覆盖原目录，再在扩展管理页点击“重新加载”。

## 使用方法

1. 打开 YouTube 普通视频页或哔哩哔哩 BV 视频页，点击工具栏中的“视频笔记”。
2. 保持侧栏使用，或点击顶部“独立窗口”弹出单独界面；点击快速标记输入框，输入想法后移开焦点，也可以按 `Cmd/Ctrl + Enter` 保存，按 `Esc` 取消。
3. 在“设置”中按需启用播放器截图、前置字幕，或提前下载本地翻译语言包。
4. 需要口述时，在笔记输入框使用系统语音输入法；扩展不再录音。
5. 看完后点击“导出 ZIP”。导出不会删除浏览器中的笔记。

## 本地数据与联网范围

笔记、字幕、截图、录音和转写结果保存在扩展自己的浏览器存储中，不会上传给开发者。扩展不包含账户、广告或分析统计。

**使用 skill 时**，你选择的 AI 客户端会读取导出内容，并按该客户端及模型服务的数据规则处理。skill 的辅助脚本只做本地文件检查、解压和目录生成，没有上传接口；这不意味着使用云端 AI 整理也全程离线。

完整字幕只通过浏览器内置 Translator API 在侧栏文档中本地翻译。扩展从字幕轨道自动识别源语言，首版允许用户选择简体中文、英语、日语、韩语或西班牙语作为目标语言；当前合并档位全部翻译完成后，可以选择只看原文、只看译文或同时查看，并在本机保存显示偏好。读取完整字幕后，也可以提前下载当前源语言到目标语言的语言包并查看进度。下载完成后才显示约 200 MiB 的预估占用，之后可断网翻译。Edge 与 Chrome 分别管理自己的语言包，实际占用、支持状态和翻译结果可能不同。扩展不会把字幕发送给开发者或第三方翻译服务。

- [产品主页](https://ironunicorn66.github.io/video-notes/)
- [隐私政策](https://ironunicorn66.github.io/video-notes/privacy/)
- [问题反馈](https://github.com/IronUnicorn66/video-notes/issues)

仓库和现有问题可公开读取；提交新问题需要登录 GitHub。仓库已启用公开 Issues。

## 本地开发

构建扩展要求 Node.js 22+；运行完整测试与 skill 脚本还需要 Python 3.10+，无需安装 Python 第三方依赖。

```bash {.line-numbers}
npm install
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-1.0.41.zip
cd artifacts && shasum -a 256 -c video-notes-edge-1.0.41.zip.sha256
```

构建完成后，在 `edge://extensions/` 或 `chrome://extensions/` 中加载本项目的 `dist` 目录。

只验证配套 skill 可运行 `npm run test:skill`。它包含 ZIP、章节覆盖和安装备份检查，以及通过扩展实际导出函数生成 ZIP 的衔接测试；合成用例不代表真实课程的分章和翻译质量已经验收。

## 支持范围

- YouTube 普通视频页。
- 哔哩哔哩普通 BV 视频页与分 P。
- 桌面版 Microsoft Edge 150 或更高版本。
- 桌面版 Google Chrome 138 或更高版本。

笔记的前置字幕优先读取当前会话已经加载的 YouTube 完整字幕，并在选中范围全部翻译后把对应译文一起保存；本地来源不可用时才读取播放器已经渲染的内容。完整字幕读取遇到平台限制时，扩展可能短暂切换 YouTube 的字幕开关以捕获播放器发起的原生字幕响应，随后恢复原先状态。哔哩哔哩会尝试通过网页播放器使用的同站接口读取当前分 P 的原生字幕轨，但该回退在部分新版页面仍可能失败；建议先开启播放器字幕。只有烧录在视频画面中的文字无法读取。

## 贡献与安全

- 一般问题与功能建议：[GitHub Issues](https://github.com/IronUnicorn66/video-notes/issues)
- 安全问题：请按 [安全政策](SECURITY.md) 私下报告。
- 详细权限与数据说明：[本地数据与权限](docs/PRIVACY.md)
- Edge 上架资料：[商店发布文案](docs/STORE_LISTING.md)
- 第三方组件：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 许可证

本项目使用 [MIT License](LICENSE)。第三方组件继续遵循各自许可证。

详见[导出格式](docs/EXPORT_FORMAT.md)与[课程地图和模型接入调研](docs/COURSE_MAP_RESEARCH.md)。
