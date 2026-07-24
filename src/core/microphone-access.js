export const MICROPHONE_CONSTRAINTS = Object.freeze({
  audio: Object.freeze({
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }),
});

export async function verifyMicrophoneAccess(getUserMedia) {
  let stream;
  try {
    stream = await getUserMedia(MICROPHONE_CONSTRAINTS);
    return true;
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
}
