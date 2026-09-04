<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">
  <img src="assets/icon.svg" width="96" alt="Video Notes icon">
</p>

<h1 align="center">Video Notes</h1>

<p align="center">Read and locally translate transcripts while capturing timestamps, screenshots, voice, and your own thoughts beside a lesson.</p>

Video Notes is an open-source extension for desktop Microsoft Edge and Google Chrome. It can stay beside YouTube and Bilibili videos as a side panel or open in a separate window, putting full-transcript reading, local browser translation, typed notes, player screenshots, local voice transcription, and Markdown export in one flow.

![Video Notes side panel](store-assets/edge/screenshot-1-note-en.png)

## What’s new in 1.0.37

- Introduces a new brand icon: one video frame flows through a curved transition into a structured note with a screenshot and text, optimized for small browser-toolbar sizes.
- Uses the new mark consistently across the extension toolbar, project documentation, product site, Edge store icon, and promotional artwork.

## What it does

- Pauses the video when you focus the quick-note editor, then saves and resumes when you move focus away.
- Works in the browser side panel or a resizable separate window. Starting a note reactivates a bound video that was moved into the background so pausing and screenshots still target the right page.
- Keeps unmodified Left/Right Arrow and Space controls available from the video page or side panel: seek 5 seconds backward/forward or toggle playback. Text editors keep normal spaces and caret movement.
- Stores the video timestamp, an optional player screenshot, and the previous 5, 10, 20, or 30 seconds of subtitles with each note. When the current YouTube transcript is already loaded, notes reuse its complete local paragraphs and include the matching local translation when the selected range is fully translated.
- Reads native subtitles actually rendered by YouTube and Bilibili, plus bilingual subtitles rendered by Immersive Translate. It also attempts to retrieve the current Bilibili part's native track, but this remains unavailable on some newer pages.
- For YouTube videos with available native captions, shows the full transcript locally with its coverage range, sentence-aware 5, 10, or 20-cue grouping targets, independent font-size controls, original/translation display choices, timestamp jumps, current-playback-position locating, and a stable reading position while translations appear or display modes change.
- Caches a loaded YouTube transcript, each completed target-language/group-size translation, and the side-panel/transcript reading positions locally. Transcript progress is restored by the same stable passage rather than pixels alone, so translation height changes do not move a reopened view backward. Retry always refreshes the source.
- Adjusts the whole side panel from 75% to 200% with the `+` and `−` buttons beside the language selector, in 10% steps.
- Enables the browser side panel only on supported YouTube and Bilibili video tabs. Switching to another page hides it; because of a known Edge issue, returning to a previously open course tab requires selecting the toolbar icon again.
- Translates sentence-aware transcript paragraphs locally with the built-in Edge/Chrome Translator API. It detects the transcript language automatically and lets you choose Simplified Chinese, English, Japanese, Korean, or Spanish as the target, with advance download and visible progress for the current language pair.
- Records while you hold Right Option/Alt or the side-panel button, then restores eligible playback when you release. Space and the Left/Right Arrow keys are reserved for playback.
- Runs Base, Small, or Medium Whisper models locally in the browser.
- Shows notes oldest-first or newest-first, with edit, delete, clear, curved-arrow undo/redo controls, and persistent 10–24 px note font sizing.
- Exports a ZIP containing Markdown, screenshots, and original recordings.

## Install

### Microsoft Edge Add-ons

[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/cndejflmchbjejlflldlmfplcadnpjkj) currently serves version 1.0.32. Version 1.0.37 is being prepared for update review; until it is approved, you can install the matching GitHub Release package.

### GitHub Release preview

[Download Video Notes 1.0.37 ZIP](https://github.com/IronUnicorn66/video-notes/releases/download/v1.0.37/video-notes-edge-1.0.37.zip)
· [SHA-256 checksum](https://github.com/IronUnicorn66/video-notes/releases/download/v1.0.37/video-notes-edge-1.0.37.zip.sha256)

1. Download the ZIP and extract it to a permanent folder.
2. Open `edge://extensions/` in Edge or `chrome://extensions/` in Chrome.
3. Turn on **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted folder that directly contains `manifest.json`.

Preview builds require manual updates. Download the new release into the same folder, then select **Reload** on the extension management page.

## Use

1. Open a standard YouTube video or a Bilibili BV video, then select Video Notes in the Edge toolbar.
2. Keep using the side panel or select **Separate window** at the top. Select the quick-note editor, type your thought, and move focus away; you can also press `Cmd/Ctrl + Enter` to save or `Esc` to cancel.
3. Open **Settings** to enable player screenshots, microphone access, lead-in subtitles, or download a local translation language pack in advance.
4. Hold Right Option/Alt or **Hold to talk** when you want to add a voice note.
5. Select and download a pinned Whisper model for local transcription. After the download, transcription can run offline.
6. Select **Export ZIP** when you finish. Exporting does not delete notes from the browser.

## Local data and network access

Notes, subtitles, screenshots, recordings, and transcription results stay in extension storage on your device. Video Notes has no account system, advertising, or analytics, and it does not upload this content to the developer.

When you first download a Whisper model, the extension retrieves static weights from a pinned `ggerganov/whisper.cpp` revision on Hugging Face, verifies the exact size and SHA-256, and caches the model locally. All JavaScript, Worker, and WASM code ships inside the extension package. The download service receives normal HTTPS connection metadata such as IP address, User-Agent, request time, and model file URL; the request contains no notes or media content.

Full transcripts are translated only in the side-panel document with the browser’s built-in Translator API. The source language is detected from the transcript track. The first release lets you choose Simplified Chinese, English, Japanese, Korean, or Spanish as the target. After the current grouping is fully translated, you can show the original, the translation, or both; the display choice is stored locally. You can also download the current source-to-target pack in advance and follow its progress; the interface shows an estimated 200 MiB footprint only after it is ready. Translation then works offline. Edge and Chrome manage their packs separately, so actual disk use, support, and output can differ. The extension never sends transcript content to the developer or a third-party translation service.

- [Product website](https://ironunicorn66.github.io/video-notes/en/)
- [Privacy policy](https://ironunicorn66.github.io/video-notes/en/privacy/)
- [Support](https://github.com/IronUnicorn66/video-notes/issues)

The repository and existing issues are public. Creating a new issue requires a GitHub login.

## Local development

Requires Node.js 22 or later.

```bash {.line-numbers}
npm install
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-1.0.37.zip
cd artifacts && shasum -a 256 -c video-notes-edge-1.0.37.zip.sha256
```

After building, load the project’s `dist` directory from `edge://extensions/` or `chrome://extensions/`.

## Supported environments

- Standard YouTube video pages.
- Standard Bilibili BV video pages, including multi-part videos.
- Microsoft Edge 150 or later on desktop.
- Google Chrome 138 or later on desktop.

Lead-in subtitles prefer complete paragraphs from the current locally loaded YouTube transcript and include its matching translation when the whole selected range has been translated. If that local source is unavailable, notes fall back to content already rendered by the player. When complete YouTube transcript retrieval is blocked, the side panel may briefly toggle the YouTube captions control to capture the native caption response requested by the player, then restore its prior state. On Bilibili, Video Notes makes a best-effort request for the current part's native track through the same-site endpoints used by the web player, but this fallback can still fail on some newer pages; enabling player captions is recommended. Text burned only into video pixels cannot be read. Subtitle content is not sent to a third-party subtitle service. Whisper performance depends on model size, device memory, and recording quality.

## Contributing and security

- Questions and feature requests: [GitHub Issues](https://github.com/IronUnicorn66/video-notes/issues)
- Security reports: follow the [security policy](SECURITY.md) for private reporting.
- Detailed permission and data notes: [local data and permissions](docs/PRIVACY.md)
- Microsoft Edge listing material: [store listing copy](docs/STORE_LISTING.md)
- Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## License

Video Notes is available under the [MIT License](LICENSE). Third-party components remain subject to their own licenses.
