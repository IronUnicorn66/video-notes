# 视频笔记 Edge 插件

在 YouTube 和哔哩哔哩看课程时快速留下时点标记。文字输入会自动暂停和续播；页面获得焦点时，按住右 Option/Alt 录音，松开后立即续播并在本机使用 Whisper 转写。

## 已实现范围

- YouTube 普通视频页、哔哩哔哩 BV 视频页和分 P 会话。
- 文字输入聚焦暂停、失焦自动保存，支持中文输入法、普通换行、`Cmd/Ctrl + Enter` 和 `Esc`。
- 右 Option/Alt 按住录音、松开结束，可重新录入物理按键；输入控件内不会触发。
- 窗口失焦、标签页隐藏、页面关闭、侧边栏关闭和 60 秒上限均会结束录音。
- 每条标记保存个人正文、播放器截图、标记前 20 秒已渲染字幕、原始 WebM/Opus 录音和跳转网址。
- 使用 IndexedDB 保存会话、标记和资产；同一视频再次打开会续接已有记录。
- 导出 ZIP，根目录为 UTF-8 Markdown，图片和录音分别放入 `images/`、`audio/`。
- 本地 `whisper.cpp` WASM 转写。首次启用下载固定的 `base-q5_1` 模型，支持分块续传和 SHA-256 校验；缓存完成后撤销模型站点权限。多条录音按队列串行转写，浏览器重启后会恢复已保存音频的待办。
- 与网课声伴 1.1.0 使用固定扩展 ID 和版本化租约协议协作。语音期间 A/B 都暂停，文字输入保留原有 A/B 接力规则。

## 本地安装

要求 Node.js 22 及以上，目标浏览器为桌面 Edge 150。

```bash {.line-numbers}
npm install
npm run build
```

打开 `edge://extensions`，启用“开发人员模式”，点击“加载解压缩的扩展”，选择本项目的 `dist` 目录。正式版 Edge 150 会忽略命令行的 `--load-extension` 参数，因此加载动作需要在扩展管理页完成。

若需同时验证网课声伴，先在 `/Users/psh/codes/browser_always_play` 运行其测试，再从该目录加载插件。两个项目的 Manifest 都带稳定公钥，开发环境 ID 会保持一致。

## 使用流程

1. 打开受支持的视频页，点击工具栏中的“视频笔记”图标打开侧边栏。
2. 首次使用时，“权限、语音与快捷键”会自动展开。点击“播放器截图”的“启用”；再点击“麦克风”的“授权”，插件会打开独立授权页，请在该页点击“允许麦克风”并确认 Edge 权限提示。成功后会自动返回发起授权的课程标签。
3. 点击输入框。插件记录当前时点、字幕与截图并暂停视频；输入内容后移开光标即可保存和续播。
4. 页面焦点位于视频时，按住右 Option/Alt 说话，松开后视频立即恢复。未启用 Whisper 时仍会保留原始录音。
5. 首次需要转写时，在“本地 Whisper”中点击“启用”，同意一次模型下载权限。
6. 看完后点击“导出 ZIP”。导出不会删除浏览器中的会话。

## 开发验证

```bash {.line-numbers}
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-0.1.3.zip
```

网课声伴的协作测试位于 `/Users/psh/codes/browser_always_play/tests`，覆盖固定发送者校验、A/B 全暂停、全局暂停保护、心跳续租和超时恢复。

## 模型与发布策略

- 模型：`ggml-base-q5_1.bin`，59,707,625 字节。
- SHA-256：`422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898`。
- 远程下载内容只有静态权重；JavaScript、Worker 和 WASM 均进入安装包。
- 如果 Edge 商店拒绝运行时模型下载，可用下列方式把同一权重内置到发布包：

```bash {.line-numbers}
VIDEO_NOTES_BUNDLED_MODEL=/absolute/path/ggml-base-q5_1.bin npm run package
```

构建脚本会再次校验文件大小和 SHA-256，校验失败会停止打包。

## 当前边界

- 插件只读取页面已经渲染的字幕，不主动打开字幕，也不调用站点私有字幕接口。
- Edge 的可见页面截图接口要求 `<all_urls>` 或临时 `activeTab` 授权。侧栏打开方式不一定产生临时授权，因此插件把 `<all_urls>` 作为用户主动启用的可选权限；实际内容脚本仍只运行于 YouTube 和哔哩哔哩视频页。
- 页面焦点离开视频后，单键按住说话无法收到键盘事件；侧边栏内可使用“按住说话”按钮。
- Whisper 的准确率和性能门槛需要使用真实说话人的 12 条样本完成实机验收，记录方式见 [验收清单](docs/ACCEPTANCE.md)。门槛未通过时继续保留文字与原始录音，不接入云端转写。
- 最终 Edge 商店 ID 由商店分配。发布前需把两个插件的互信 ID 更新为商店 ID，并重新执行协议测试。

隐私说明见 [本地数据与权限](docs/PRIVACY.md)，第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
