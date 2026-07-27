# 0.3.0 最终修复报告

## 范围

- 基线：`c308990d7b2789471307fbc9c3f6cf9ed5dd1b31`
- 分支：`codex/final-fix-history-feature`
- 发布版本：`0.3.0`
- 修复项：2 项 Important、2 项 Minor，未修改需求和版本号。

## 修复结果

### Important 1：软删除后的陈旧编辑污染历史

- `mutateNoteValue` 在 notes/history 同一事务内要求目标笔记处于 `saved` 且没有 `deletedAt`。
- 已删除笔记的正文和字幕陈旧编辑会拒绝，拒绝过程不新增历史；原删除动作仍可撤销并恢复原内容。
- 未保存草稿也不能进入带历史的编辑路径。
- 历史操作 pending 时，正文和字幕行内编辑控制器拒绝创建编辑会话。

RED 证据：

- `node --test --test-name-pattern='已删除笔记|历史操作等待期间' tests/storage.test.js tests/sidepanel-interaction.test.js`：3 项失败、0 项通过；两个陈旧编辑缺少预期拒绝，pending 时仍返回编辑会话。
- `node --test --test-name-pattern='尚未保存的草稿' tests/storage.test.js`：1 项失败、0 项通过；草稿编辑缺少预期拒绝。

GREEN 证据：

- `node --test --test-name-pattern='已删除笔记|尚未保存的草稿|历史操作等待期间' tests/storage.test.js tests/sidepanel-interaction.test.js`：4 项通过、0 项失败。

### Important 2：活动标签广播跨窗口改写侧栏绑定

- `ACTIVE_CONTEXT_CHANGED` 载荷增加 `windowId`。
- 侧栏刷新控制器保存自己的 `windowId`，只接管同窗口的活动标签。
- 后台优先按 `chrome.runtime.getContexts` 中与 sender `documentId` 匹配的 side-panel context 解析标签页和窗口。
- context 缺少有效 `tabId` 时查询该 context 所属窗口的活动标签；Edge 同时缺少有效 tab/window 信息时保留 last-focused 回退。
- `GET_SIDEPANEL_CONTEXT` 返回 `{ tabId, windowId }`，历史请求复用同一解析路径。

RED 证据：

- `node --test --test-name-pattern='活动标签广播|两个窗口|侧栏文档解析|活动课程标签切换' tests/sidepanel-scope.test.js`：3 项失败、1 项通过；广播缺少窗口契约、A 窗口错误接管 B 窗口标签、context 窗口回退解析缺失。

GREEN 证据：

- 同一命令：4 项通过、0 项失败。
- `node --test tests/sidepanel-scope.test.js tests/sidepanel-note-sort.test.js`：25 项通过、0 项失败。
- 独立审查要求补强后台接线后，`node --test --test-name-pattern='后台标签激活处理器|后台侧栏解析器' tests/sidepanel-scope.test.js` 的初始 RED 为 2 项失败、0 项通过；activation handler 和 context resolver 尚未形成可注入生产边界。
- 后台改为直接使用可注入 handler/resolver 后，同一命令为 2 项通过、0 项失败。测试直接断言 runtime 广播载荷、指定窗口 tabs query、Edge last-focused query 和双窗口 sender 隔离。

### Minor 1：事务 abort 完成前提前拒绝

- callback、request 和 transaction 错误先缓存。
- callback 抛错后调用 `transaction.abort()`。
- 成功只从 `oncomplete` resolve；失败只从 `onabort` reject，并优先返回原 callback error。

RED 证据：

- `node --test --test-name-pattern='历史事务先派发 abort' tests/storage.test.js`：1 项失败、0 项通过；Promise 拒绝时测试尚未观察到 abort 事件。

GREEN 证据：

- 同一命令：1 项通过、0 项失败。
- `node --test tests/storage.test.js`：15 项通过、0 项失败。

### Minor 2：历史操作成功反馈与删除确认文案

- DELETE、CLEAR、UNDO、REDO 在请求与刷新均成功后分别显示“已删除标记”“已清空标记”“已撤销”“已反撤销”。
- 请求或刷新失败时不显示成功反馈，继续显示错误。
- 删除确认增加“可通过撤销恢复”。

RED 证据：

- `node --test --test-name-pattern='四类历史操作|只在请求及刷新成功后反馈' tests/note-history-controls.test.js`：2 项失败、0 项通过；提示映射和成功回调缺失。
- `node --test --test-name-pattern='笔记卡片把删除' tests/sidepanel-history-ui.test.js`：1 项失败、0 项通过；删除确认缺少恢复说明。

GREEN 证据：

- 上述两个聚焦命令分别为 2 项通过和 1 项通过，均为 0 失败。
- `node --test tests/note-history-controls.test.js tests/sidepanel-history-ui.test.js tests/sidepanel-interaction.test.js`：26 项通过、0 项失败。
- 独立审查使用真实 refresh runner 复现刷新错误后仍显示成功提示；`node --test --test-name-pattern='历史操作刷新失败' tests/sidepanel-interaction.test.js` 的初始 RED 为 1 项失败、0 项通过，返回值错误地为 true。
- 必须应用的刷新路径改为传播错误后，同一命令为 1 项通过、0 项失败；普通背景刷新仍可应用错误界面，历史操作不会显示成功反馈。

## 最终验证

- 聚焦验证：`node --test tests/storage.test.js tests/note-history.test.js tests/note-history-controls.test.js tests/sidepanel-scope.test.js tests/sidepanel-history-ui.test.js tests/sidepanel-interaction.test.js tests/manifest.test.js`，91 项通过、0 项失败。
- 全量验证：`npm test`，193 项通过、0 项失败。
- 打包：`npm run package`，退出码 0。
- ZIP 完整性：`unzip -t artifacts/video-notes-edge-0.3.0.zip`，压缩数据无错误。
- 内嵌版本：读取 ZIP 内 `manifest.json` 得到 `0.3.0`。
- 差异格式：`git diff --check`，退出码 0。

## 产物

- 文件：`artifacts/video-notes-edge-0.3.0.zip`
- 大小：`3,386,699 bytes`
- SHA-256：`bdf66ab63f0f49e58716d262c9c8cf4b4910525f1fb687a0a5e4a78b9a7aa074`

## 自审

- 每个生产行为修改都有对应 RED 和 GREEN 记录。
- 数据库校验位于权威事务内，拒绝路径不提交笔记或历史。
- 多窗口逻辑保留单窗口切换、有效 context、缺失 tabId 和 Edge 全缺失回退四条路径。
- 成功反馈发生在刷新成功后，失败状态不会显示成功文案。
- 独立只读审查发现的刷新错误语义和后台契约覆盖两项 Important 均已按 RED/GREEN 修复。
- 改动仅涉及 brief 指定的存储、侧栏 scope、交互反馈、测试和 0.3.0 ZIP。
- 自动化验证未覆盖 Edge 实机多窗口和跨重启交互，按设计验收清单留给用户执行。
