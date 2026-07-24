const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function isEditableTarget(target) {
  if (!target) return false;
  const tagName = String(target.tagName ?? "").toUpperCase();
  return (
    EDITABLE_TAGS.has(tagName) ||
    target.isContentEditable === true ||
    target.getAttribute?.("role") === "textbox"
  );
}

export class PushToTalkController {
  constructor({
    keyCode = "AltRight",
    maxDurationMs = 60_000,
    onStart,
    onStop,
  }) {
    this.keyCode = keyCode;
    this.maxDurationMs = maxDurationMs;
    this.onStart = onStart;
    this.onStop = onStop;
    this.isActive = false;
    this.isStarting = false;
    this.pendingStopReason = null;
    this.timeoutId = null;
  }

  async keyDown(event) {
    if (
      event.code !== this.keyCode ||
      event.repeat ||
      this.isActive ||
      this.isStarting ||
      isEditableTarget(event.target)
    ) {
      return false;
    }

    this.isStarting = true;
    try {
      await this.onStart();
      this.isActive = true;
      this.timeoutId = setTimeout(() => this.forceStop("timeout"), this.maxDurationMs);
    } catch (error) {
      this.pendingStopReason = null;
      throw error;
    } finally {
      this.isStarting = false;
    }

    if (this.pendingStopReason) {
      const reason = this.pendingStopReason;
      this.pendingStopReason = null;
      await this.forceStop(reason);
    }
    return true;
  }

  async keyUp(event) {
    if (event.code !== this.keyCode) return false;
    if (this.isStarting) {
      this.pendingStopReason = "keyup";
      return true;
    }
    return this.forceStop("keyup");
  }

  async forceStop(reason) {
    if (this.isStarting) {
      this.pendingStopReason = reason;
      return true;
    }
    if (!this.isActive) return false;

    this.isActive = false;
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
    await this.onStop(reason);
    return true;
  }

  reset() {
    const wasActive = this.isActive || this.isStarting;
    this.isActive = false;
    this.isStarting = false;
    this.pendingStopReason = null;
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
    return wasActive;
  }
}
