export function reportWhisperRuntimeMessage(
  message,
  { debug = console.debug, error = console.error } = {},
) {
  const output = /(?:abort(?:ed)?|error|exception|fail(?:ed|ure)?)/i.test(String(message))
    ? error
    : debug;
  output("Whisper", message);
}
