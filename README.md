<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">
  <img src="assets/icon.svg" width="96" alt="Video Notes icon">
</p>

<h1 align="center">Video Notes</h1>

<p align="center">Turn video courses into navigable Chinese study maps with an AI skill and a companion capture extension.</p>

**See the whole lesson, then jump back to the part you need.** Video Notes pairs the [video-notes skill](skills/video-notes/SKILL.md) with a desktop Edge/Chrome extension. The extension captures original transcripts, timestamps, screenshots, and your thoughts. The skill reads the export and creates Chinese chapter maps, summaries, and answers to your annotated questions, as Markdown you can also use in Obsidian.

**Capture a lesson → Export ZIP → Run the skill → Course map + study notes**

| Component | Role | Output |
| --- | --- | --- |
| video-notes skill | Read the complete source, group topics, answer your questions | Chinese chapters, clickable timestamps, explanations, source references |
| Browser extension | Take notes, capture screenshots, collect timed subtitles | Markdown, attachments, full original JSON / SRT / Markdown when available |

Timestamp links open the corresponding point in the original video. Full-track export currently supports YouTube. Legacy exports and Bilibili annotations remain usable; incomplete source material produces partial notes instead of a purported whole-course map. The AI running the skill writes Chinese headings and summaries. Browser translation remains available while watching.

## Start with the companion skill

You need an AI client that supports local skills and file access, plus Python 3.10+. The installer below targets Codex. The skill does not include a model, subscription, or API credits.

Download or clone this repository, then run from its root:

```bash {.line-numbers}
python3 scripts/install-video-notes-skill.py
```

This copies [skills/video-notes/](skills/video-notes/) to `$CODEX_HOME/skills/video-notes`, or `~/.codex/skills/video-notes` if `CODEX_HOME` is unset. An existing skill is preserved under `skill-backups/` in the same parent directory; the installer prints its location. Run the command again after updating the repository. For other clients, copy the entire skill folder according to that client's installation conventions.

1. Install the browser extension below and select **Export ZIP** on a course page. A full transcript can be exported even without annotations.
2. Open your intended notes folder in the AI client and invoke the installed skill in a new task:

   > Use $video-notes to import my latest video-note export, create a Chinese course map, and answer the questions in my annotations.

3. You can also specify a ZIP and output folder, or request just a map:

   > Use $video-notes to read this course ZIP in full. Create Chinese chapter headings, summaries, and clickable timestamps in my study folder. Keep the original transcript attachments.

Existing Obsidian note locations are preserved; a new project defaults to `Video Notes/`. Typical outputs are:

- **Study notes.md**: your annotations, screenshots, course context, and AI explanations.
- **Course map.md**: Chinese chapters, optional subtopics, summaries, and video links.
- **Course map.json**: chapter ranges and provenance tied to the original source cues.
- **Source attachments**: original JSON / SRT / Markdown, screenshots, and legacy audio.

The skill checks source coverage and timestamp references while preserving human content. The AI still needs to review chapter meaning and explanations. Map import into the extension and in-extension model login or automatic invocation are not implemented. The extension ZIP and the skill are installed separately; this repository contains both.

## What’s new in 1.0.41

- A companion video-notes skill, an installer that backs up existing skills, and tools to validate exports and course maps.
- Export every available source cue with its original text, millisecond start/end times, and video links as JSON, SRT, and Markdown.
- Export a course even without notes; missing transcripts are explicitly marked.
- Remove recording, hold-to-talk, microphone authorization, Whisper runtime and model downloads. Existing notes and audio attachments remain readable and exportable.

## Browser extension features

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
- Shows notes oldest-first or newest-first, with edit, delete, clear, curved-arrow undo/redo controls, and persistent 10–24 px note font sizing.
- Exports a ZIP containing Markdown, screenshots, and original timed transcripts when available.

## Install the browser extension

### Microsoft Edge Add-ons

[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/cndejflmchbjejlflldlmfplcadnpjkj) currently serves version 1.0.32. Version 1.0.41 is a local, unpublished build. The download links below become available after publication.

### GitHub Release preview

[Download Video Notes 1.0.41 ZIP](https://github.com/IronUnicorn66/video-notes/releases/download/v1.0.41/video-notes-edge-1.0.41.zip)
· [SHA-256 checksum](https://github.com/IronUnicorn66/video-notes/releases/download/v1.0.41/video-notes-edge-1.0.41.zip.sha256)

1. Download the ZIP and extract it to a permanent folder.
2. Open `edge://extensions/` in Edge or `chrome://extensions/` in Chrome.
3. Turn on **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted folder that directly contains `manifest.json`.

Preview builds require manual updates. Download the new release into the same folder, then select **Reload** on the extension management page.

## Use

1. Open a standard YouTube video or a Bilibili BV video, then select Video Notes in the Edge toolbar.
2. Keep using the side panel or select **Separate window** at the top. Select the quick-note editor, type your thought, and move focus away; you can also press `Cmd/Ctrl + Enter` to save or `Esc` to cancel.
3. Open **Settings** to enable player screenshots, lead-in subtitles, or download a local translation language pack in advance.
4. Use your system dictation input method in the text editor if you prefer speaking. The extension does not record audio.
5. Select **Export ZIP** when you finish. Exporting does not delete notes from the browser.

## Local data and network access

Notes, subtitles, screenshots, recordings, and transcription results stay in extension storage on your device. Video Notes has no account system, advertising, or analytics, and it does not upload this content to the developer.

**When using the skill**, your chosen AI client reads the export and processes it under that client and model provider's data policies. The helper scripts only inspect local files, extract ZIPs, and render maps; they have no upload endpoint. Using a cloud AI client to organize notes is therefore not an entirely offline workflow.

Full transcripts are translated only in the side-panel document with the browser’s built-in Translator API. The source language is detected from the transcript track. The first release lets you choose Simplified Chinese, English, Japanese, Korean, or Spanish as the target. After the current grouping is fully translated, you can show the original, the translation, or both; the display choice is stored locally. You can also download the current source-to-target pack in advance and follow its progress; the interface shows an estimated 200 MiB footprint only after it is ready. Translation then works offline. Edge and Chrome manage their packs separately, so actual disk use, support, and output can differ. The extension never sends transcript content to the developer or a third-party translation service.

- [Product website](https://ironunicorn66.github.io/video-notes/en/)
- [Privacy policy](https://ironunicorn66.github.io/video-notes/en/privacy/)
- [Support](https://github.com/IronUnicorn66/video-notes/issues)

The repository and existing issues are public. Creating a new issue requires a GitHub login.

## Local development

Building the extension requires Node.js 22+. Running the full test suite and skill scripts also requires Python 3.10+, with no third-party Python packages.

```bash {.line-numbers}
npm install
npm test
npm run build
npm run package
unzip -t artifacts/video-notes-edge-1.0.41.zip
cd artifacts && shasum -a 256 -c video-notes-edge-1.0.41.zip.sha256
```

After building, load the project’s `dist` directory from `edge://extensions/` or `chrome://extensions/`.

Run `npm run test:skill` to check ZIP handling, chapter coverage, and installation backups, including a ZIP generated by the extension's actual export function. Synthetic fixtures do not validate real-course chapter or translation quality.

## Supported environments

- Standard YouTube video pages.
- Standard Bilibili BV video pages, including multi-part videos.
- Microsoft Edge 150 or later on desktop.
- Google Chrome 138 or later on desktop.

Lead-in subtitles prefer complete paragraphs from the current locally loaded YouTube transcript and include its matching translation when the whole selected range has been translated. If that local source is unavailable, notes fall back to content already rendered by the player. When complete YouTube transcript retrieval is blocked, the side panel may briefly toggle the YouTube captions control to capture the native caption response requested by the player, then restore its prior state. On Bilibili, Video Notes makes a best-effort request for the current part's native track through the same-site endpoints used by the web player, but this fallback can still fail on some newer pages; enabling player captions is recommended. Text burned only into video pixels cannot be read. Subtitle content is not sent to a third-party subtitle service.

## Contributing and security

- Questions and feature requests: [GitHub Issues](https://github.com/IronUnicorn66/video-notes/issues)
- Security reports: follow the [security policy](SECURITY.md) for private reporting.
- Detailed permission and data notes: [local data and permissions](docs/PRIVACY.md)
- Microsoft Edge listing material: [store listing copy](docs/STORE_LISTING.md)
- Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## License

Video Notes is available under the [MIT License](LICENSE). Third-party components remain subject to their own licenses.

See [the export format](docs/EXPORT_FORMAT.md) and [course map integration research](docs/COURSE_MAP_RESEARCH.md).
