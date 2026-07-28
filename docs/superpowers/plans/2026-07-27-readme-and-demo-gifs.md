# README 与实际使用 GIF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实 Edge 操作生成文字与语音演示 GIF，重写精简 README，并把当前分支发布到 `IronUnicorn66/video_notes` 私有仓库。

**Architecture:** 使用 Microsoft Edge 中已加载的真实扩展完成演示，逐状态保存窗口截图，再由 FFmpeg 裁切、缩放和生成循环 GIF。README 只承担项目首页职责，完整模型与隐私细节链接到现有文档；Node 行为测试验证首页资产可解析、GIF 有效且没有本机绝对路径。

**Tech Stack:** Microsoft Edge 150、Manifest V3、Computer Use、Node.js 22、`node:test`、FFmpeg 8、Git、GitHub CLI。

## Global Constraints

- GitHub 仓库固定为 `IronUnicorn66/video_notes`，可见性为 private。
- GIF 必须来自真实 Edge 插件操作，不能使用产品示意稿代替。
- GIF 只保留视频内容和插件侧栏，裁掉垂直标签栏、地址栏、账号头像、其他扩展和桌面内容。
- 文字演示使用“这里值得回看：模型从数据中学习表示”，并在保存前按 `Esc` 取消。
- 语音演示使用独立视频会话，录音约两秒，不包含个人谈话。
- GIF 宽度不超过 1000 像素，约 10–12 FPS，每段约 8–12 秒，单个文件目标不超过 8 MiB。
- 所有 commit 消息使用简体中文和 `<类型>: <简短描述>` 格式。
- Markdown 中的代码块全部使用 `【代码语言】{.line-numbers}` 标注。

---

### Task 1: 录制并生成真实操作 GIF

**Files:**
- Create: `docs/assets/text-note-demo.gif`
- Create: `docs/assets/voice-note-demo.gif`
- Temporary: `/tmp/video-notes-readme-demo/text/`
- Temporary: `/tmp/video-notes-readme-demo/voice/`

**Interfaces:**
- Consumes: Edge 中 ID 为 `kkgmnhjilijgmkgafcafhmhgcoegeoll` 的已加载扩展，以及公开 YouTube 视频 `https://www.youtube.com/watch?v=kuYAsz7zspQ`。
- Produces: README 可以通过相对路径引用的两段有效 GIF。

- [ ] **Step 1: 建立独立演示会话并检查画面**

在 Edge 新标签打开 `https://www.youtube.com/watch?v=kuYAsz7zspQ`，刷新页面后打开视频笔记侧栏。确认标题为 Lecture 2、时间线没有现有笔记，且麦克风与播放器截图权限可用。

- [ ] **Step 2: 建立临时帧目录**

Run:

```bash {.line-numbers}
mkdir -p /tmp/video-notes-readme-demo/text
mkdir -p /tmp/video-notes-readme-demo/voice
mkdir -p docs/assets
```

Expected: 三个目录均存在，仓库中只新增空的 `docs/assets/` 目录，临时帧不进入 Git。

- [ ] **Step 3: 捕获文字记录行为帧**

用 Computer Use 操作真实侧栏，并在每个状态调用 `get_app_state({ app: "Microsoft Edge", disableDiff: true })` 保存截图：

1. `001-playing.png`：视频播放、输入框为空。
2. `002-paused.png`：输入框获得焦点、视频暂停。
3. `003-typed-1.png`：输入“这里值得回看：”。
4. `004-typed-2.png`：继续输入“模型从数据中”。
5. `005-typed-3.png`：继续输入“学习表示”。
6. `006-resumed.png`：按 `Esc` 取消后视频恢复、输入框清空。

每张截图保存到 `/tmp/video-notes-readme-demo/text/`。检查时间线没有新增文字笔记。

- [ ] **Step 4: 捕获语音记录行为帧**

在侧栏“按住说话”按钮上打开 Edge 检查工具，进入该 `sidepanel.html` 的 Console。执行下列脚本，让真实按钮触发 `pointerdown`，三秒后触发 `pointerup`；脚本只负责保持指针状态，录音、暂停、续播和笔记保存仍走扩展现有消息链路：

```js {.line-numbers}
const button = document.querySelector("#voice-button");
const setPointerCapture = button.setPointerCapture;
button.setPointerCapture = () => {};
button.dispatchEvent(new PointerEvent("pointerdown", {
  bubbles: true,
  pointerId: 1,
}));
setTimeout(() => {
  button.dispatchEvent(new PointerEvent("pointerup", {
    bubbles: true,
    pointerId: 1,
  }));
  button.setPointerCapture = setPointerCapture;
}, 3000);
```

执行后立即回到课程窗口，在独立会话按下列状态保存：

1. `001-playing.png`：视频播放、按钮显示“按住说话”。
2. `002-recording-0.png`：按钮按下，显示“松开结束”和 `00:00`。
3. `003-recording-1.png`：保持约一秒，计时显示 `00:01`。
4. `004-recording-2.png`：保持约两秒，计时显示 `00:02`。
5. `005-resumed.png`：松开按钮后视频恢复。
6. `006-note.png`：时间线出现带原始录音的语音标记。

每张截图保存到 `/tmp/video-notes-readme-demo/voice/`。录音期间保持安静，不说出个人信息。

- [ ] **Step 5: 写入可重复的帧时长清单**

为文字与语音目录各创建 `frames.txt`。每个状态使用 0.8–1.8 秒持续时间，最后一帧重复一次，使总时长分别落在 8–12 秒。

文字清单内容：

```text {.line-numbers}
file '001-playing.png'
duration 1.5
file '002-paused.png'
duration 1.3
file '003-typed-1.png'
duration 1.0
file '004-typed-2.png'
duration 1.0
file '005-typed-3.png'
duration 1.5
file '006-resumed.png'
duration 2.2
file '006-resumed.png'
```

语音清单内容：

```text {.line-numbers}
file '001-playing.png'
duration 1.2
file '002-recording-0.png'
duration 1.2
file '003-recording-1.png'
duration 1.2
file '004-recording-2.png'
duration 1.4
file '005-resumed.png'
duration 1.2
file '006-note.png'
duration 2.0
file '006-note.png'
```

- [ ] **Step 6: 生成裁切后的 GIF**

Computer Use 的 Edge 窗口截图为 1248×704。使用 `crop=1073:624:175:80` 去除左侧垂直标签栏和顶部浏览器栏，再缩放到 1000 像素宽。Run:

```bash {.line-numbers}
ffmpeg -y -f concat -safe 0 -i /tmp/video-notes-readme-demo/text/frames.txt -vf "crop=1073:624:175:80,scale=1000:-1:flags=lanczos,fps=12,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" -loop 0 docs/assets/text-note-demo.gif
ffmpeg -y -f concat -safe 0 -i /tmp/video-notes-readme-demo/voice/frames.txt -vf "crop=1073:624:175:80,scale=1000:-1:flags=lanczos,fps=12,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" -loop 0 docs/assets/voice-note-demo.gif
```

Expected: 两个 GIF 都可以循环播放，宽度为 1000，单个文件小于 8 MiB。

- [ ] **Step 7: 验证 GIF 元数据和隐私画面**

Run:

```bash {.line-numbers}
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,avg_frame_rate -show_entries format=duration,size -of json docs/assets/text-note-demo.gif
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,avg_frame_rate -show_entries format=duration,size -of json docs/assets/voice-note-demo.gif
```

Expected: `codec_name` 为 `gif`，宽度为 1000，`avg_frame_rate` 为 12 FPS，时长 8–12 秒，大小低于 8,388,608 字节。逐帧检查没有标签名、邮箱、账号头像、本地路径和现有课程笔记。

- [ ] **Step 8: 提交 GIF 资产**

```bash {.line-numbers}
git add docs/assets/text-note-demo.gif docs/assets/voice-note-demo.gif
git commit -m "新增: 添加 README 操作演示"
```

### Task 2: 重写精简 README 并添加文档行为测试

**Files:**
- Modify: `README.md`
- Create: `tests/readme.test.js`

**Interfaces:**
- Consumes: Task 1 生成的 `docs/assets/text-note-demo.gif` 与 `docs/assets/voice-note-demo.gif`。
- Produces: GitHub 首页 README 和可自动验证的资产链接契约。

- [ ] **Step 1: 写入失败的 README 行为测试**

创建 `tests/readme.test.js`：

```js {.line-numbers}
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url));

test("README 引用两段有效 GIF 且不包含本机绝对路径", async () => {
  const markdown = (await read("README.md")).toString("utf8");
  const assets = [
    "docs/assets/text-note-demo.gif",
    "docs/assets/voice-note-demo.gif",
  ];

  for (const asset of assets) {
    assert.match(markdown, new RegExp(`\\(${asset.replaceAll("/", "\\/")}\\)`));
    const bytes = await read(asset);
    assert.equal(bytes.subarray(0, 6).toString("ascii"), "GIF89a");
    assert.ok(bytes.byteLength < 8 * 1024 * 1024);
  }

  assert.doesNotMatch(markdown, /\/Users\/psh\//);
});
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run:

```bash {.line-numbers}
node --test tests/readme.test.js
```

Expected: FAIL，因为旧 README 尚未引用两段 GIF，并且仍包含本机用户目录绝对路径。

- [ ] **Step 3: 用精简首页内容重写 README**

使用 `apply_patch` 更新 `README.md`，按以下固定顺序组织：

1. `# 视频笔记 Edge 插件` 与一句话价值说明。
2. `## 实际使用`，分别以 `![文字快速标记](docs/assets/text-note-demo.gif)` 和 `![按住说话](docs/assets/voice-note-demo.gif)` 引用 GIF。
3. `## 核心能力`，列出文字暂停/续播、语音、本地 Whisper、截图字幕、正倒序和 ZIP 导出。
4. `## 快速安装`，包含 Node.js 22、`npm install`、`npm run build` 和加载 `dist`。
5. `## 使用方式`，用六步说明授权、文字、语音、模型、时间线和导出。
6. `## 本地数据与隐私`，说明数据留在 IndexedDB、本地 WASM 转写、仅模型首次下载联网。
7. `## 开发验证`，包含 `npm test`、`npm run build`、`npm run package`。
8. `## 支持范围`，链接 `docs/ACCEPTANCE.md`、`docs/PRIVACY.md` 和 `THIRD_PARTY_NOTICES.md`。

删除旧 README 中的本机绝对路径；网课声伴改为通用项目名称说明。

- [ ] **Step 4: 运行 README 行为测试并确认通过**

Run:

```bash {.line-numbers}
node --test tests/readme.test.js
```

Expected: PASS，两个 GIF 链接可解析、文件头有效、文件大小合规且 README 没有本机绝对路径。

- [ ] **Step 5: 运行完整回归**

Run:

```bash {.line-numbers}
npm test
npm run build
git diff --check
```

Expected: 全部测试通过、构建退出码为 0、差异检查没有输出。

- [ ] **Step 6: 提交 README 和行为测试**

```bash {.line-numbers}
git add README.md tests/readme.test.js
git commit -m "更新: 精简 README 并补充使用说明"
```

### Task 3: 创建私有 GitHub 仓库并推送

**Files:**
- Modify: `.git/config`（由 Git 添加 `origin`）

**Interfaces:**
- Consumes: 干净的 `feat/video-notes-mvp` 分支和已认证的 GitHub 账号 `IronUnicorn66`。
- Produces: `https://github.com/IronUnicorn66/video_notes` 私有仓库以及远端跟踪分支。

- [ ] **Step 1: 检查目标仓库不存在且工作区干净**

Run:

```bash {.line-numbers}
git status -sb
gh repo view IronUnicorn66/video_notes --json nameWithOwner,visibility,url
```

Expected: Git 工作区干净；第二条命令返回仓库不存在。如果仓库已经存在，停止创建并核对其可见性和内容，不覆盖远端。

- [ ] **Step 2: 创建私有仓库并绑定 origin**

Run:

```bash {.line-numbers}
gh repo create IronUnicorn66/video_notes --private --source=. --remote=origin --description "Edge 视频课程笔记插件：文字暂停记录、按住说话、本地 Whisper、截图字幕与 Markdown 导出"
```

Expected: 创建成功，`git remote get-url origin` 返回 `https://github.com/IronUnicorn66/video_notes.git`。

- [ ] **Step 3: 推送当前分支并设置跟踪**

Run:

```bash {.line-numbers}
git push -u origin feat/video-notes-mvp
```

Expected: 推送成功，本地分支跟踪 `origin/feat/video-notes-mvp`。

- [ ] **Step 4: 验证远端隐私、提交和 README 资产**

Run:

```bash {.line-numbers}
gh repo view IronUnicorn66/video_notes --json nameWithOwner,visibility,url,defaultBranchRef
git status -sb
git ls-remote --heads origin feat/video-notes-mvp
```

Expected: `visibility` 为 `PRIVATE`，远端分支提交与本地 HEAD 相同，Git 状态显示已跟踪且没有领先或落后。

使用 GitHub 仓库页面检查 README 两段 GIF 都可以显示；不创建 Pull Request。
