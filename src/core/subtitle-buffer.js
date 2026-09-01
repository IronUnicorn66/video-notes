import {
  formatSubtitleFragments,
  truncateSubtitleText,
} from "./subtitle-segmentation.js";

function normalizeText(text) {
  return String(text ?? "")
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}


export class SubtitleBuffer {
  constructor({ retentionSeconds = 60 } = {}) {
    this.retentionSeconds = retentionSeconds;
    this.items = [];
  }

  add(seconds, text) {
    const at = Number(seconds);
    const normalized = normalizeText(text);
    if (!Number.isFinite(at) || !normalized) return;

    const last = this.items.at(-1);
    if (!last || last.text !== normalized) {
      this.items.push({ seconds: at, text: normalized });
    }

    const cutoff = at - this.retentionSeconds;
    this.items = this.items.filter((item) => item.seconds >= cutoff);
  }

  clear() {
    this.items = [];
  }

  before(markerSeconds, { seconds = 20, maxChars = 500 } = {}) {
    const end = Number(markerSeconds);
    if (!Number.isFinite(end) || maxChars <= 0) return "";

    const eligible = this.items.filter(
      (item) => item.seconds <= end && item.seconds >= end - seconds,
    );
    return truncateSubtitleText(
      formatSubtitleFragments(eligible.map((item) => item.text)),
      maxChars,
    );
  }
}
