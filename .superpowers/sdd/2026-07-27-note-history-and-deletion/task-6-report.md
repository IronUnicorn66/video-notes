# Task 6 发布报告

## RED / GREEN

- RED：将 `tests/manifest.test.js` 的发布版本期望更新为 `0.3.0` 后执行 `node --test tests/manifest.test.js`。版本断言以实际值 `0.2.2` 对期望值 `0.3.0` 失败，其余 21 项通过。
- GREEN：同步 `manifest.json`、`package.json` 与 `package-lock.json` 的根包版本为 `0.3.0` 后，执行 `node --test tests/manifest.test.js`，22 项通过。
- 全量验证：执行 `npm test`，180 项通过，0 项失败。

## 发布产物

- 文件：`artifacts/video-notes-edge-0.3.0.zip`
- 大小：3,382,525 bytes
- SHA-256：`345fd2c8d0c264c1ff4004bb97e3db04084f8afc203daf70e1c8868d22806c55`
- `npm run package`：通过。
- `unzip -t artifacts/video-notes-edge-0.3.0.zip`：通过，无压缩数据错误。
- `unzip -p artifacts/video-notes-edge-0.3.0.zip manifest.json | rg '"version": "0.3.0"'`：匹配 1 次。
- `git diff --check`：无输出。

## 自审

- README、商店文案与人工验收清单明确：时间点新增可撤销，新建视频会话不可撤销；每会话持久保存最近 50 次历史；删除和清空先确认；清空为原子操作；软删除笔记的截图和录音在历史不再引用后最终回收。
- 人工验收清单覆盖文字/语音新增、正文/字幕编辑、单条删除、原子清空、重做失效、跨重启历史及资产恢复。
- 未进行 Edge 实机操作；所有标记为“待用户手动验收”的项目仍需由用户在桌面 Edge 150 完成。
