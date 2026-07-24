export const STUDY_SOUND_EXTENSION_ID = "gbjogdiimlejbeamknhelkkgpfaikdik";
export const VIDEO_NOTES_EXTENSION_ID = "kkgmnhjilijgmkgafcafhmhgcoegeoll";
export const NOTE_HOLD_PROTOCOL_VERSION = 1;
export const NOTE_HOLD_TIMEOUT_MS = 90_000;

export function noteHoldMessage(type, { leaseId, tabId, shouldResumeMain = false }) {
  return {
    type,
    protocolVersion: NOTE_HOLD_PROTOCOL_VERSION,
    leaseId,
    tabId,
    timeoutMs: NOTE_HOLD_TIMEOUT_MS,
    shouldResumeMain,
  };
}

