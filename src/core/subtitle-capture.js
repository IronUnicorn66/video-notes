import { SubtitleBuffer } from "./subtitle-buffer.js";

export const SUBTITLE_WINDOW_OPTIONS = Object.freeze([5, 10, 20, 30]);

export function normalizeSubtitleSettings(values = {}) {
  const windowSeconds = Number.isInteger(values.subtitleWindowSeconds)
    && SUBTITLE_WINDOW_OPTIONS.includes(values.subtitleWindowSeconds)
    ? values.subtitleWindowSeconds
    : 20;
  return {
    enabled: typeof values.subtitleEnabled === "boolean"
      ? values.subtitleEnabled
      : true,
    windowSeconds,
  };
}

export class SubtitleCapture {
  constructor(values = {}) {
    const settings = normalizeSubtitleSettings(values);
    this.enabled = settings.enabled;
    this.windowSeconds = settings.windowSeconds;
    this.buffer = new SubtitleBuffer({ retentionSeconds: 60 });
  }

  updateSettings(values = {}) {
    const settings = normalizeSubtitleSettings({
      subtitleEnabled: Object.hasOwn(values, "subtitleEnabled")
        ? values.subtitleEnabled
        : this.enabled,
      subtitleWindowSeconds: Object.hasOwn(values, "subtitleWindowSeconds")
        ? values.subtitleWindowSeconds
        : this.windowSeconds,
    });
    if (this.enabled && !settings.enabled) this.buffer.clear();
    this.enabled = settings.enabled;
    this.windowSeconds = settings.windowSeconds;
  }

  add(seconds, text) {
    if (this.enabled) this.buffer.add(seconds, text);
  }

  before(markerSeconds) {
    return this.enabled
      ? this.buffer.before(markerSeconds, {
        seconds: this.windowSeconds,
        maxChars: 500,
      })
      : "";
  }

  clear() {
    this.buffer.clear();
  }
}
