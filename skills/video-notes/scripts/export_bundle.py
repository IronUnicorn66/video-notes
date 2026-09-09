"""Read the Video Notes export contract without executing archive contents."""
from __future__ import annotations

import json
import math
import re
import stat
import unicodedata
import zipfile
from pathlib import PurePosixPath
from urllib.parse import quote

MAX_FILES = 10000
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_TEXT_BYTES = 64 * 1024 * 1024
SOURCE = re.compile(r'https://(?:www\.)?(?:youtube\.com/watch\?|youtu\.be/|bilibili\.com/video/)', re.I)
TIME = re.compile(r'\[\d{2}:\d{2}:\d{2}\]\(https://')


class ExportError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ExportError(message)


def safe_name(name):
    require(isinstance(name, str) and bool(name), "ZIP path is empty")
    require('\\' not in name and '\x00' not in name and ':' not in name, "Unsafe ZIP path")
    parts = name.rstrip('/').split('/')
    require(not name.startswith('/') and all(p not in ('', '.', '..') for p in parts), "Unsafe ZIP path")
    require(all(not p.endswith((' ', '.')) for p in parts), "Ambiguous ZIP path")
    require(all(not re.fullmatch(r'(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', p, re.I) for p in parts),
            "Reserved ZIP path")
    return str(PurePosixPath(*parts))


def checked_members(archive):
    entries = archive.infolist()
    require(len(entries) <= MAX_FILES, "ZIP contains too many entries")
    require(sum(i.file_size for i in entries) <= MAX_TOTAL_BYTES, "ZIP exceeds 512 MiB uncompressed limit")
    seen = {}
    files = []
    for entry in entries:
        path = safe_name(entry.filename)
        key = unicodedata.normalize('NFC', path).casefold()
        require(key not in seen, "ZIP contains duplicate or case-colliding paths")
        require(not entry.flag_bits & 1, "Encrypted ZIP is unsupported")
        mode = stat.S_IFMT(entry.external_attr >> 16)
        require(mode in (0, stat.S_IFREG, stat.S_IFDIR), "ZIP links or special files are unsupported")
        seen[key] = entry.is_dir()
        if not entry.is_dir():
            files.append(entry.filename)
    for key in seen:
        parent = PurePosixPath(key).parent
        while str(parent) != '.':
            require(seen.get(str(parent), True), "ZIP file conflicts with a parent directory")
            parent = parent.parent
    return files


def read_text(archive, path, limit=MAX_TEXT_BYTES):
    require(path in archive.namelist() and not archive.getinfo(path).is_dir(), f"Missing export file: {path}")
    require(archive.getinfo(path).file_size <= limit, "Export metadata exceeds text size limit")
    return archive.read(path).decode('utf-8-sig')


def read_json(archive, path):
    value = json.loads(read_text(archive, path))
    require(isinstance(value, dict), "Expected a JSON object")
    return value


def jump_url(context, milliseconds):
    video_id = context.get('videoId', '')
    require(isinstance(video_id, str) and re.fullmatch(r'[A-Za-z0-9_-]+', video_id), "Invalid video identifier")
    seconds = math.floor(milliseconds / 1000)
    if context.get('platform') == 'youtube':
        return f'https://www.youtube.com/watch?v={quote(video_id)}&t={seconds}s'
    require(context.get('platform') == 'bilibili' and video_id.startswith('BV'), "Unsupported video platform")
    part = context.get('part', 1)
    require(type(part) is int and part > 0, "Invalid Bilibili part")
    return f'https://www.bilibili.com/video/{video_id}?p={part}&t={seconds}'


def valid_time(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def validate_transcript(data):
    require(isinstance(data, dict) and data.get('schemaVersion') == 1, "Unsupported transcript schema")
    require(data.get('timingUnit') == 'milliseconds', "Unsupported timing unit")
    require(data.get('segmentation') == 'source-cues', "Expected original source cues")
    require(isinstance(data.get('sessionId'), str) and data['sessionId'], "Missing transcript session")
    require(isinstance(data.get('languageCode'), str), "Missing transcript language")
    cues = data.get('cues')
    require(isinstance(cues, list) and cues, "Missing transcript cues")
    ids = set()
    previous_start = 0
    for cue in cues:
        require(isinstance(cue, dict), "Invalid cue")
        cue_id = cue.get('id')
        require(isinstance(cue_id, str) and cue_id and cue_id not in ids, "Missing or duplicate cue ID")
        ids.add(cue_id)
        start, end = cue.get('startMs'), cue.get('endMs')
        require(valid_time(start) and valid_time(end) and end >= start, "Invalid cue time")
        require(start >= previous_start, "Transcript cues are not chronologically ordered")
        require(isinstance(cue.get('text'), str) and cue['text'].strip(), "Empty cue text")
        require(cue.get('jumpUrl') == jump_url(data, start), "Cue link does not match video/time")
        previous_start = start
    coverage = data.get('coverage', {})
    require(isinstance(coverage, dict), "Invalid transcript coverage")
    require(coverage.get('cueCount') == len(cues), "Transcript cue count mismatch")
    require(coverage.get('startMs') == cues[0]['startMs'], "Transcript start mismatch")
    require(coverage.get('endMs') == max(c['endMs'] for c in cues), "Transcript end mismatch")
    require(coverage.get('completeness') == 'source-track-not-verified-against-audio', "Unknown transcript completeness")
    return data


def inspect_archive(path):
    with zipfile.ZipFile(path) as archive:
        files = checked_members(archive)
        markdown = [n for n in files if n.lower().endswith('.md')]
        images = [n for n in files if n.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif'))]
        audio = [n for n in files if n.lower().endswith(('.webm', '.mp3', '.wav', '.m4a', '.ogg'))]
        transcript = None
        manifest = None
        if 'export.json' in files:
            manifest = read_json(archive, 'export.json')
            require(manifest.get('kind') == 'video-notes-export' and manifest.get('schemaVersion') == 1,
                    "Unsupported export manifest")
            notes = safe_name(manifest.get('notesFile'))
            require(notes in markdown, "Manifest notesFile is not a Markdown file")
            read_text(archive, notes)
            session = manifest.get('session')
            require(isinstance(session, dict) and session.get('id'), "Missing export session")
            jump_url(session, 0)
            require(type(manifest.get('noteCount')) is int and manifest['noteCount'] >= 0, "Invalid note count")
            source = manifest.get('transcript')
            require(isinstance(source, dict) and source.get('status') in ('included', 'unavailable'), "Missing transcript status")
            if source['status'] == 'included':
                json_file = safe_name(source.get('jsonFile'))
                transcript = validate_transcript(read_json(archive, json_file))
                for key in ['platform', 'videoId', 'part']:
                    require(transcript.get(key) == session.get(key), "Transcript belongs to another course")
                require(transcript['sessionId'] == session['id'], "Transcript session mismatch")
                require(source.get('cueCount') == len(transcript['cues']), "Export cue count mismatch")
                for key in ['srtFile', 'markdownFile']:
                    require(safe_name(source.get(key)) in files, "Missing transcript companion file")
                require(len({notes, json_file, source['srtFile'], source['markdownFile']}) == 4,
                        "Notes and transcript files must be distinct")
            else:
                require(source.get('cueCount') == 0, "Unavailable transcript has cues")
        else:
            candidates = []
            for name in markdown:
                text = read_text(archive, name, 4 * 1024 * 1024)
                if SOURCE.search(text) and TIME.search(text):
                    candidates.append(name)
            require(len(candidates) == 1, "Legacy ZIP needs one unambiguous video-note Markdown")
            notes = candidates[0]
        return {
            'format': 'v1' if manifest else 'legacy',
            'notes_file': notes,
            'session': manifest.get('session') if manifest else None,
            'note_count': manifest.get('noteCount') if manifest else None,
            'transcript_file': manifest['transcript']['jsonFile'] if transcript else None,
            'transcript': {k: transcript[k] for k in ['sessionId', 'languageCode', 'coverage']} if transcript else None,
            'images': images,
            'audio': audio,
            'files': files,
        }
