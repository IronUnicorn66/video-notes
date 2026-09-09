# 视频笔记导出格式（1.0.41）

ZIP 继续包含以课程标题命名的主 Markdown、`images/` 截图，以及旧版笔记引用的 `audio/` 附件。主 Markdown 先呈现用户批注，再附完整字幕入口；导出不修改原始笔记或附件。

## 字幕文件

| 路径 | 用途 |
| --- | --- |
| `export.json` | 固定入口，包含 `kind: video-notes-export`、格式版本、课程信息、主笔记路径、批注数与字幕状态 |
| `transcript/original.json` | 程序及 skill 优先读取；原文逐条保留，包含毫秒时间与视频链接 |
| `transcript/original.srt` | 标准字幕工具读取；起止时间格式为 `HH:MM:SS,mmm` |
| `transcript/original.md` | 人直接阅读；每条原文前有可点击的起止时间 |

没有完整字幕时，主 Markdown 明确说明缺失，`export.json` 的 `transcript.status` 为 `unavailable`，不会生成空的完整字幕文件。字幕存在时状态为 `included`。即使没有批注，也可以导出当前课程。

## JSON 约定

两个 JSON 文件的 `schemaVersion` 均为 `1`，与扩展的发布版本分别维护。根清单的 `notesFile` 指向主笔记，`transcript.jsonFile`、`srtFile`、`markdownFile` 指向字幕附件。

原文 JSON 保留课程的 `sessionId`、`platform`、`videoId`、`part`、`title` 和 `canonicalUrl`，以及字幕的 `source`、`languageCode`、`label`、`automatic`。无法确认是否自动生成时，`automatic` 为 `null`；不会把未知语言或非英语强行标注为英语。

`cues` 按来源顺序保存，每项包括：

- `id`：例如 `cue-000001`，对应本次来源轨中的顺序；字幕源重试后内容变化时不可直接复用旧 ID 对应的 AI 结果。
- `startMs`、`endMs`：来源中的起止毫秒数，JSON 不先取整、不重分组。
- `text`：字幕读取模块提供的原文，包括其中的换行。
- `jumpUrl`：对应原视频链接；YouTube 使用 `t=整数s`，Bilibili 格式支持分 P。网站链接向下取整到秒，以免越过字幕开头。

`coverage` 包含条数及最早、最晚时间。`completeness: source-track-not-verified-against-audio` 表示来源轨未经整段音频核验；字幕空白、自动识别错误和缺失语句仍可能存在。`segmentation: source-cues` 表示这是来源字幕分块，不是 AI 章节。

SRT 将时间舍入到毫秒、规范换行并移除字幕块内的空白行，以符合字幕文件格式；需要核对原始精度与原文时以 JSON 为准。Markdown 会转义原文中的标记字符和 HTML，避免字幕破坏排版。

## 来源与兼容边界

本版接入现有 YouTube 完整字幕缓存与读取流程。导出优先使用当前界面的原文，其次读取同视频的本地缓存；仍没有缓存时尝试取得完整字幕。失败时继续导出批注并标明缺口。原文导出不受 5/10/20 合并档位、译文显示选择或浏览器翻译质量影响。

本版未新增 Bilibili 完整轨导出入口；Bilibili 仍保留原有的笔记前置字幕。JSON 格式可容纳该平台，但不代表本版已支持全轨导出。

旧 ZIP 没有 `export.json`，整理工具仍应兼容原有主 Markdown 与附件结构。新版有多个 Markdown，工具必须从 `notesFile` 确定主笔记，不能把 `transcript/original.md` 误当作用户批注。

## 配套 skill

仓库中的 [video-notes skill](../skills/video-notes/SKILL.md) 读取此格式，生成中文课程地图与批注点评。安装与调用方法见 [README](../README.zh-CN.md#开始使用配套-skill)。章节计划使用原 cue ID，渲染脚本从字幕计算起止时间，并生成带原文 SHA-256 的地图 JSON；原文附件保持不变。旧 ZIP 或 `unavailable` 导出只整理已有材料，不补造全课目录。
