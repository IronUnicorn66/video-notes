# 沉浸式翻译字幕采集与侧栏展示设计

日期：2026-07-27

## 问题与证据

当前 YouTube 课程页可以显示由“沉浸式翻译”生成的双语字幕，但视频笔记保存的 `subtitleContext` 为空，侧栏与导出的 Markdown 都没有前置字幕。

已确认页面结构为：

- 字幕宿主：`#immersive-translate-caption-window`。
- 字幕内容位于宿主的 open Shadow DOM。
- 原文节点：`.source-cue.imt-cue`。
- 译文节点：`.target-cue.imt-cue`。

现有内容脚本只在普通 DOM 查询 YouTube 原生 `.ytp-caption-segment`，无法跨越 Shadow DOM。侧栏当前也没有渲染 `NoteEntry.subtitleContext`。

## 目标

- 继续支持 YouTube 原生字幕和哔哩哔哩现有字幕选择器。
- YouTube 原生字幕为空时，读取沉浸式翻译当前可见的原文字幕。
- 沉浸式翻译原文为空时回退到当前可见译文。
- 每条已保存笔记在侧栏直接显示采集到的前置字幕。
- Markdown 导出继续沿用现有“前置字幕”块，不改变数据结构和导出格式。

## 字幕读取规则

新增独立、可测试的字幕读取函数，由内容脚本传入当前 `document` 和平台。

YouTube 按以下优先级返回第一组非空字幕：

1. 普通 DOM 中当前可见的 `.ytp-caption-segment`。
2. `#immersive-translate-caption-window.shadowRoot` 中当前可见的 `.source-cue.imt-cue`。
3. 同一 Shadow DOM 中当前可见的 `.target-cue.imt-cue`。

哔哩哔哩继续读取当前可见的 `.bpx-player-subtitle-panel-text` 和 `.bilibili-player-video-subtitle`。

每组字幕执行相同清理：去除首尾空白、忽略空节点、按页面顺序合并，并去除同组内相邻重复文本。只有 `getClientRects().length > 0` 的节点视为当前可见字幕。宿主不存在、Shadow DOM 未开放或节点为空时返回空字符串，不记录告警。

该实现只定向支持已确认的沉浸式翻译结构，不递归遍历页面全部 Shadow DOM，避免读取播放器按钮、弹窗和其他扩展文字。

## 侧栏展示

笔记卡片在个人正文和截图之后增加“前置字幕”区域：

- `subtitleContext` 非空时显示标题和完整文本，保留换行。
- `subtitleContext` 为空时不显示占位块。
- 字幕使用次级文字样式，不提供编辑入口，也不改变笔记排序。
- 录音播放器、转写状态和告警继续使用现有顺序。

侧栏展示只读取已保存在笔记中的字幕，不重新访问视频页面。因此旧笔记的 `subtitleContext` 为空时不会自动补录；修复加载后新建的笔记会包含字幕。

## 数据流

1. 内容脚本沿用现有 400 毫秒轮询，读取当前已渲染字幕并写入最近 60 秒缓冲。
2. 创建标记时从缓冲截取标记前 20 秒、最多 500 字。
3. 后台把结果保存到现有 `NoteEntry.subtitleContext`。
4. 侧栏显示该字段，ZIP 导出继续把它写入 Markdown。

不新增权限、存储字段、网络请求或站点接口调用。

## 行为测试

- YouTube 原生字幕存在时优先返回原生字幕。
- 原生字幕为空时读取 open Shadow DOM 中的沉浸式原文。
- 原文为空时回退沉浸式译文。
- Shadow DOM 不存在、关闭或字幕隐藏时安全返回空字符串。
- 哔哩哔哩现有字幕读取行为保持不变。
- 同组相邻重复字幕只保留一次。
- 侧栏仅在 `subtitleContext` 非空时显示“前置字幕”和对应文本。
- 完整测试、构建和 ZIP Markdown 验证通过。

## 实机验收

在当前 Lecture 3 页面重新加载扩展，保持沉浸式翻译字幕可见并观看至少 20 秒，然后新建文字笔记：

- 侧栏笔记卡片显示标记前的原文字幕。
- 导出 ZIP 的 Markdown 包含相同“前置字幕”块。
- 视频暂停、截图、续播和既有笔记排序行为保持正常。
