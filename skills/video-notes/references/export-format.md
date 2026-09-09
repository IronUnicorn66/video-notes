# 导出读取约定

新版 ZIP 的固定入口是 `export.json`，其 `kind` 为 `video-notes-export`、`schemaVersion` 为 1。`notesFile` 指向根目录中的主批注 Markdown；`session` 包含课程平台、视频 ID、分 P、标题和原始链接；`noteCount` 是批注数。

`transcript.status` 为 `included` 时，`jsonFile`、`srtFile`、`markdownFile` 指向全量字幕附件。JSON 最适合推理和验证；SRT 便于外部字幕工具使用；Markdown 便于人直接阅读。`unavailable` 表示本次没有全量原文，不能据零散前置字幕构造全课地图。

原文 JSON 中：

- `sessionId`、`platform`、`videoId`、`part` 对应同一个课程。
- `source`、`languageCode`、`label`、`automatic` 记录真实来源；`automatic: null` 表示未知。非英语不能当作英语。
- `cues` 每项有 `id`、`startMs`、`endMs`、`text`、`jumpUrl`，单位是毫秒，顺序与来源字幕一致。
- `segmentation: source-cues` 是原始分块，与侧栏的 5/10/20 合并阅读档位无关。
- `coverage` 的 `cueCount`、`startMs`、`endMs` 表示来源覆盖；`completeness: source-track-not-verified-against-audio` 说明它未对照整段音频核验。可能有无字幕间隙、自动识别错误或来源缺句。

JSON 保留原文与来源精度；SRT 时间舍入到毫秒并规范空白行；Markdown 会转义排版字符。原文内容不可因生成中文目录而被改写。

cue ID 仅在本次原文文件中稳定。重采集可能改变 ID 对应内容；课程地图同时记录原文 JSON 的 SHA-256，不能把旧地图附给另一版本原文。

旧 ZIP 没有清单，通常是一个主 Markdown 加 `images/`、`audio/`。检查真实视频来源和笔记时间链接，不只按压缩包名字判断。旧版没有全量原文时仍保留批注、截图、旧录音和点评能力。

当前扩展的全量轨导出入口支持 YouTube；Bilibili 仍导出笔记前置字幕。本 skill 的地图渲染格式支持分 P 链接，不代表扩展已能导出 Bilibili 全量轨。
