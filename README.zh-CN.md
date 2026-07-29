<p align="center"><strong>简体中文</strong> · <a href="README.md">English</a></p>

<p align="center">
  <img src="assets/icon.svg" width="96" alt="视频笔记图标">
</p>

<h1 align="center">视频笔记</h1>

<p align="center">看课程时快速留下时点、截图、字幕和自己的想法。</p>

视频笔记是一款面向 Microsoft Edge 的开源扩展。它在 YouTube 和哔哩哔哩视频旁提供持续可见的笔记侧栏，让文字记录、播放器截图、标记前字幕、本地语音转写和 Markdown 导出保持在同一条时间线上。

![视频笔记侧栏示意](store-assets/edge/screenshot-1-note.png)

## 核心能力

- 点击快速标记输入框时暂停视频，移开焦点后自动保存并续播。
- 每条笔记保存视频时点、播放器截图和可配置的标记前 5、10、20 或 30 秒字幕。
- 支持 YouTube、哔哩哔哩原生字幕，以及沉浸式翻译呈现的双语字幕。
- 按住右 Option/Alt 或侧栏按钮录音，松开后恢复播放。
- Base、Small、Medium 三种 Whisper 模型均在浏览器本机运行。
- 正序或倒序查看时间线，支持编辑、删除、清空、撤销和反撤销。
- 导出 ZIP，包含 Markdown、截图和原始录音。

## 安装

### Edge 商店

1.0.3 正在准备 Microsoft Edge Add-ons 首次审核。商店页面开放后，官网会把主安装入口切换为商店安装。

### GitHub Release 测试版

[下载视频笔记 1.0.3 ZIP](https://github.com/IronUnicorn66/video-notes/releases/download/v1.0.3/video-notes-edge-1.0.3.zip)
· [SHA-256 校验文件](https://github.com/IronUnicorn66/video-notes/releases/download/v1.0.3/video-notes-edge-1.0.3.zip.sha256)

1. 下载 ZIP 并解压到固定目录。
2. 在 Edge 地址栏打开 `edge://extensions/`。
3. 开启“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择解压后的目录；该目录内应直接包含 `manifest.json`。

测试版需要手动更新。新版本发布后，请重新下载并覆盖原目录，再在扩展管理页点击“重新加载”。

## 使用方法

1. 打开 YouTube 普通视频页或哔哩哔哩 BV 视频页，点击工具栏中的“视频笔记”。
2. 点击快速标记输入框，输入想法后移开焦点；也可以按 `Cmd/Ctrl + Enter` 保存，按 `Esc` 取消。
3. 在“权限、语音与快捷键”中按需启用播放器截图、麦克风和前置字幕。
4. 需要语音记录时，按住右 Option/Alt 或“按住说话”按钮。
5. 需要本地转写时，选择并下载固定的 Whisper 模型；下载完成后可离线转写。
6. 看完后点击“导出 ZIP”。导出不会删除浏览器中的笔记。

## 本地数据与联网范围

笔记、字幕、截图、录音和转写结果保存在扩展自己的浏览器存储中，不会上传给开发者。扩展不包含账户、广告或分析统计。

首次下载 Whisper 模型时，扩展会从 `ggerganov/whisper.cpp` 的固定 Hugging Face revision 下载静态权重，校验固定文件大小和 SHA-256 后缓存到本机。JavaScript、Worker 和 WASM 全部包含在扩展安装包中。下载服务会收到普通 HTTPS 请求的 IP、User-Agent、请求时间和模型文件地址等连接元数据；请求不包含用户笔记或媒体内容。

- [产品主页](https://ironunicorn66.github.io/video-notes/)
- [隐私政策](https://ironunicorn66.github.io/video-notes/privacy/)
- [问题反馈](https://github.com/IronUnicorn66/video-notes/issues)

仓库和现有问题可公开读取；提交新问题需要登录 GitHub。仓库已启用公开 Issues。

## 本地开发

要求 Node.js 22 或更高版本。

```bash {.line-numbers}
npm install
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-1.0.3.zip
cd artifacts && shasum -a 256 -c video-notes-edge-1.0.3.zip.sha256
```

构建完成后，在 `edge://extensions/` 中加载本项目的 `dist` 目录。

## 支持范围

- YouTube 普通视频页。
- 哔哩哔哩普通 BV 视频页与分 P。
- 桌面版 Microsoft Edge 150 或更高版本。

扩展只读取播放器已经渲染的字幕，不主动开启字幕，也不调用视频网站的私有字幕接口。Whisper 性能取决于模型大小、设备内存和录音质量。

## 贡献与安全

- 一般问题与功能建议：[GitHub Issues](https://github.com/IronUnicorn66/video-notes/issues)
- 安全问题：请按 [安全政策](SECURITY.md) 私下报告。
- 详细权限与数据说明：[本地数据与权限](docs/PRIVACY.md)
- Edge 上架资料：[商店发布文案](docs/STORE_LISTING.md)
- 第三方组件：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 许可证

本项目使用 [MIT License](LICENSE)。第三方组件继续遵循各自许可证。
