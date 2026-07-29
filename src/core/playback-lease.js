export function acquirePlaybackLease(
  media,
  { now = Date.now(), ttlMs = 90_000, wasPlaying = !media.paused } = {},
) {
  return {
    wasPlaying,
    pluginPaused: wasPlaying,
    userIntervened: false,
    acquiredAt: now,
    expiresAt: now + ttlMs,
    shouldPause: wasPlaying && !media.paused,
  };
}

export function markPlaybackIntervention(lease, action, now = Date.now()) {
  if (!lease) return null;
  return {
    ...lease,
    userIntervened: true,
    intervention: action,
    interventionAt: now,
  };
}

export function markPlayerPointerIntervention(lease, player, target, now = Date.now()) {
  if (!lease || !player?.contains(target)) return lease;
  return markPlaybackIntervention(lease, "player-pointerdown", now);
}

export function releasePlaybackLease(lease, media, now = Date.now()) {
  if (!lease) return { shouldPlay: false, reason: "missing" };
  if (now > lease.expiresAt) return { shouldPlay: false, reason: "expired" };
  if (lease.userIntervened) return { shouldPlay: false, reason: "user-intervened" };
  if (!lease.wasPlaying || !lease.pluginPaused) {
    return { shouldPlay: false, reason: "not-owned" };
  }
  if (!media.paused) return { shouldPlay: false, reason: "already-playing" };
  return { shouldPlay: true, reason: "owned" };
}
