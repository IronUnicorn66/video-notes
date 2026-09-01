# 项目开发约定

## 版本规则

- 每个独立改动批次都必须递增扩展版本号。
- 用户未指定版本级别时，默认递增补丁版本。
- `manifest.json`、`package.json`、`package-lock.json`、发布测试和当前发布文档中的版本必须保持一致。

## Worktree 与浏览器手动测试

- 功能开发使用独立 Git worktree，不直接在项目原路径的工作区中开发。
- 需要用户在浏览器中手动测试时，先在当前功能 worktree 中完成最新构建，再将该 worktree 的 `dist` 完整同步到固定原路径 `/Users/psh/codes/video_notes/dist`。
- 同步只覆盖生成的 `dist`，不把功能分支源文件复制到项目原路径，也不修改原工作区的分支或源代码。
- 同步后必须确认两个 `dist` 目录内容一致，并确认 `/Users/psh/codes/video_notes/dist/manifest.json` 的版本等于当前功能版本；用户随后只需在浏览器扩展页点击“重新加载”。
