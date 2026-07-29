# 视频笔记 Edge 商店上架资料

更新日期：2026-07-29
版本：1.0.3

本文件保存 Microsoft Partner Center 首次上架时可直接填写的内容。提交前应再次核对发布 ZIP、实际权限、公开页面和产品能力。

## 1. 基本信息

- 产品名称：视频笔记
- 类别：生产力
- 可见性：公开
- 市场：全部市场
- 支持语言：中文（简体）
- 成熟内容：否
- 网站：https://ironunicorn66.github.io/video-notes/
- 隐私政策：https://ironunicorn66.github.io/video-notes/privacy/
- 支持页面：https://github.com/IronUnicorn66/video-notes/issues
- Edge Product ID：`ce0862d8-274e-4f87-9cfb-bf523f3f792a`
- Edge Store ID：`0RDCKGDTZD56`
- Edge CRX ID：`cndejflmchbjejlflldlmfplcadnpjkj`
- 首次提交：2026-07-28，状态为 `In review`

## 2. 商店名称与说明

### 名称

视频笔记

### 简短说明

在 YouTube 和哔哩哔哩课程中用文字或按住说话快速标记，导出带截图、字幕和录音的 Markdown。

### 完整说明

视频笔记把观看课程时产生的想法直接放在视频旁边，减少暂停、切换窗口和事后整理的成本。

打开受支持的视频后，侧栏会显示当前课程和快速标记输入框。点击输入框会暂停视频；输入完成并移开焦点后，笔记自动保存，视频按原状态恢复。每条记录包含准确时点和跳转链接，并可按用户设置附带播放器截图与标记前 5、10、20 或 30 秒已经渲染的字幕。

插件支持 YouTube 和哔哩哔哩原生字幕，也可以读取沉浸式翻译已经显示在播放器上的双语字幕。字幕只来自当前页面的可见内容，插件不会主动打开字幕，也不会调用视频网站的私有字幕接口。

需要语音记录时，可以按住右 Option/Alt 或侧栏中的“按住说话”按钮。松开后会保存原始 WebM/Opus 录音。用户可以选择下载 Base、Small 或 Medium 三种固定 Whisper 模型，在本机完成语音转写；模型权重经过固定文件大小和 SHA-256 校验，JavaScript、Worker 与 WASM 均包含在安装包中。

时间线支持正文和字幕编辑、正序或倒序显示、删除、清空、撤销与反撤销。看完课程后可以导出 ZIP：根目录为 UTF-8 Markdown，截图与录音分别存放在 `images/` 和 `audio/` 目录。

笔记、截图、字幕、录音和转写结果保存在浏览器本机。插件不创建账户，不包含广告或分析统计，也不会把这些内容上传给开发者。

### 单一用途说明

视频笔记只用于在用户正在观看的 YouTube 或哔哩哔哩课程视频中记录带时点的个人笔记，并把用户选择的截图、已渲染字幕、原始录音和本地转写一起整理为可编辑、可导出的学习记录。

### 搜索词

视频笔记、网课、字幕、截图、语音转写、Markdown、学习工具

## 3. 权限理由

### `storage`

在浏览器本机保存快捷键、前置字幕设置、时间线排序、Whisper 模型状态和一次性联动提示。笔记及二进制资产使用扩展自己的 IndexedDB 与 Cache Storage。

### `activeTab`

在用户主动打开侧栏并执行标记操作时访问当前课程标签页，用于读取播放器时点和执行可见页面截图。插件不会在后台扫描浏览历史。

### `scripting`

当受支持视频页的内容脚本尚未连接时，注入扩展包内的本地内容脚本，恢复视频时点、字幕与播放器交互。插件不会下载或执行远程脚本。

### `sidePanel`

在视频旁提供持续可见的快速输入框、权限设置和笔记时间线。

### `offscreen`

在用户已授权麦克风后，由隐藏扩展页维持按住说话录音、运行本地 Whisper WASM/Worker 并生成导出 Blob。

### `downloads`

仅在用户点击“导出 ZIP”后，把生成的 Markdown、截图和录音压缩包保存到用户选择的下载位置。

### 默认网站访问权限

`https://www.youtube.com/*`、`https://youtube.com/*`、`https://www.bilibili.com/*` 和 `https://bilibili.com/*` 只用于受支持的视频页面。内容脚本读取播放器状态、当前时点与已经渲染的字幕，并响应用户的暂停、续播和标记操作。

### 可选 `<all_urls>` 权限

Edge 的可见页面截图接口要求 `<all_urls>` 或一次临时 `activeTab` 授权。插件只在用户点击“启用播放器截图”并接受 Edge 权限提示后申请；实际截图仍只发生在受支持的 YouTube 和哔哩哔哩视频页。用户可以在 Edge 扩展设置中撤销该权限；侧栏会显示当前授权状态。

### 可选模型主机权限

`https://huggingface.co/*`、`https://cdn-lfs.hf.co/*` 和 `https://*.xethub.hf.co/*` 只在用户主动下载本地 Whisper 模型时申请。下载完成并通过固定摘要校验后，扩展会撤销这些主机权限。

## 4. 远程代码

选择：No, I am not using remote code。

扩展包包含全部 JavaScript、HTML、CSS、图片、Worker 和 WASM。运行时只会按用户操作下载固定 revision 的静态 Whisper 模型权重；权重文件不会作为代码执行。

固定 revision：`98aa99a0a9db05ae2342309f5096248665f7cba3`

- Base：`ggml-base-q5_1.bin`，59,707,625 字节，SHA-256 `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898`。
- Small：`ggml-small-q5_1.bin`，190,085,487 字节，SHA-256 `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb`。
- Medium：`ggml-medium-q5_0.bin`，539,212,467 字节，SHA-256 `19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f`。

## 5. 数据与隐私披露

### 实际处理的数据

- 当前视频地址、标题、站点、视频标识、分 P 和播放时点。
- 用户输入的笔记正文与编辑历史。
- 当前页面已经渲染的字幕片段。
- 用户主动启用后截取的可见播放器画面。
- 用户按住说话期间的麦克风录音与本地转写结果。
- 模型选择、下载状态、快捷键和时间线排序设置。

### 使用和共享

- 所有个人内容都保存在用户设备本地。
- 不创建开发者账户，不收集身份信息。
- 不包含广告、分析 SDK 或行为追踪。
- 不把笔记、字幕、截图、录音、转写或视频访问记录传给开发者。
- 不出售、出租或共享用户数据。
- 唯一的外部下载是用户主动选择的静态 Whisper 模型权重。下载服务会收到普通 HTTPS 请求的 IP、User-Agent、请求时间和模型文件地址等连接元数据；请求不包含用户笔记或媒体内容。

如果表单询问扩展是否访问或处理网站内容、浏览活动或音频，应选择与上述实际行为一致的“是”，并说明个人内容只在本机处理且服务于公开的单一用途。隐私政策必须同时披露模型下载所需的第三方服务和连接元数据。

## 6. 商店图片

- 商店图标：`store-assets/edge/logo-300.png`，300 × 300。
- 小型宣传图：`store-assets/edge/promo-440x280.png`，440 × 280。
- 截图 1：`store-assets/edge/screenshot-1-note.png`，1280 × 800。
- 截图 2：`store-assets/edge/screenshot-2-context.png`，1280 × 800。
- 截图 3：`store-assets/edge/screenshot-3-export.png`，1280 × 800。

图片使用产品界面示意和中性课程内容，不包含真实账号、个人笔记或第三方品牌 Logo。

## 7. 审核步骤

审核人员无需扩展账户。

1. 安装扩展后，打开任意公开 YouTube 普通视频或哔哩哔哩 BV 视频。
2. 点击工具栏中的“视频笔记”，确认右侧栏显示当前视频标题和快速标记输入框。
3. 点击输入框，确认视频暂停；输入一条测试文字后点击侧栏空白处，确认笔记保存且视频恢复。
4. 开启播放器字幕并播放约 20 秒，再创建一条文字笔记；确认笔记卡片出现标记前字幕。
5. 在“权限、语音与快捷键”中点击“启用播放器截图”，接受 Edge 可选权限提示；再创建笔记，确认卡片出现播放器截图。
6. 点击麦克风“授权”，在独立授权页再次点击允许并接受浏览器权限提示。返回课程页面后，按住侧栏“按住说话”按钮约两秒，松开后确认生成带原始录音的笔记。
7. 本地 Whisper 为可选功能。选择 Base 并点击“下载并使用”，同意模型主机权限；等待固定权重下载和摘要校验完成，再录制一条语音，确认本地转写进入笔记。
8. 点击“导出 ZIP”，确认下载包包含 Markdown；启用过截图或录音时，包内同时包含对应 `images/` 或 `audio/` 文件。

核心文字标记、字幕和导出无需登录第三方账号。模型下载约 57 MiB，审核时间有限时可跳过本地转写步骤，原始录音仍可验证。

## 8. 发布包检查

- ZIP 根目录直接包含 `manifest.json`。
- Manifest V3 版本为 1.0.3，默认语言为 `zh_CN`。
- ZIP 包含 `_locales/zh_CN/messages.json` 和 `_locales/en/messages.json`。
- ZIP 不包含测试、开发文档、商店素材、Git 元数据或模型权重。
- 包内没有远程 JavaScript 或动态代码加载器。
- 232 项自动化测试、构建和 ZIP 完整性校验均通过；用户已在 Edge 150 完成加载、YouTube 原生字幕与沉浸式翻译双语字幕烟测，其余人工路径见 `docs/ACCEPTANCE.md`。
- 主页、隐私政策和支持页面可公开读取并返回 HTTP 200；提交 GitHub Issue 需要登录 GitHub。

## 9. 官方参考

- [发布 Microsoft Edge 扩展](https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension)
- [更新 Microsoft Edge 扩展](https://learn.microsoft.com/microsoft-edge/extensions/update/update-extension)
- [Microsoft Edge 扩展开发者政策](https://learn.microsoft.com/legal/microsoft-edge/extensions/developer-policies)
