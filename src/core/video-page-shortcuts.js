import {
  controlVideoPlayback,
  findPrimaryVideo,
  playbackCommandForKeyEvent,
  shouldExecutePlaybackCommand,
} from "./video-playback-shortcuts.js";

const VIDEO_SHORTCUT_BINDING = Symbol.for("video-notes.videoPlaybackShortcuts");

export function installVideoPageShortcuts({
  eventTarget,
  root,
  getContext,
  getViewport,
  onError = () => {},
}) {
  if (eventTarget[VIDEO_SHORTCUT_BINDING]) {
    return eventTarget[VIDEO_SHORTCUT_BINDING];
  }

  const claimPlaybackEvent = (event) => {
    const command = playbackCommandForKeyEvent(event);
    if (!command) return null;

    const context = getContext();
    const media = findPrimaryVideo(root, getViewport());
    if (!context || !media) return null;

    event.preventDefault();
    event.stopImmediatePropagation();
    return { command, context, media };
  };

  const keydown = (event) => {
    const claimed = claimPlaybackEvent(event);
    if (!claimed) return;
    const { command, context, media } = claimed;
    if (!shouldExecutePlaybackCommand(event, command)) return;

    void controlVideoPlayback({ media, context, command }).catch(onError);
  };
  const keyup = (event) => {
    claimPlaybackEvent(event);
  };

  eventTarget.addEventListener("keydown", keydown, true);
  eventTarget.addEventListener("keyup", keyup, true);
  const binding = { keydown, keyup };
  eventTarget[VIDEO_SHORTCUT_BINDING] = binding;
  return binding;
}
