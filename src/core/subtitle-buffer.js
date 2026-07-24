function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
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

  before(markerSeconds, { seconds = 20, maxChars = 500 } = {}) {
    const end = Number(markerSeconds);
    if (!Number.isFinite(end) || maxChars <= 0) return "";

    const eligible = this.items.filter(
      (item) => item.seconds <= end && item.seconds >= end - seconds,
    );
    const selected = [];
    let length = 0;

    for (let index = eligible.length - 1; index >= 0; index -= 1) {
      const text = eligible[index].text;
      const separatorLength = selected.length === 0 ? 0 : 1;
      const remaining = maxChars - length - separatorLength;
      if (remaining <= 0) break;
      if (text.length > remaining) {
        if (selected.length === 0) selected.unshift(text.slice(-remaining));
        break;
      }
      selected.unshift(text);
      length += text.length + separatorLength;
    }

    return selected.join("\n");
  }
}

