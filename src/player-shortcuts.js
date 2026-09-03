import { installVideoPageShortcuts } from "./core/video-page-shortcuts.js";
import { parseVideoContext } from "./core/site-adapter.js";

installVideoPageShortcuts({
  eventTarget: window,
  root: document,
  getContext: () => parseVideoContext(location.href),
  getViewport: () => ({ width: innerWidth, height: innerHeight }),
  onError: (error) => console.warn("视频笔记播放器快捷键执行失败", error),
});
