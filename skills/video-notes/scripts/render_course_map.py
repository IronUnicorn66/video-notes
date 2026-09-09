#!/usr/bin/env python3
"""Render an AI-authored chapter plan using verified source cue times."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from export_bundle import jump_url, require, safe_name, validate_transcript


def escape(text):
    text = str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return re.sub(r'([\\`*_{}\[\]()#+.!|~-])', r'\\\1', text).replace('\r', ' ').replace('\n', ' ')


def timestamp(ms):
    seconds = int(ms // 1000)
    return f'{seconds // 3600:02}:{seconds % 3600 // 60:02}:{seconds % 60:02}'


def render_map(transcript, plan, source_sha256, export_file):
    validate_transcript(transcript)
    require(safe_name(export_file) == export_file and '/' not in export_file and export_file.lower().endswith('.zip'),
            'Export file must be the original ZIP filename')
    require(isinstance(plan, dict), 'Chapter plan must be an object')
    cues = transcript['cues']
    positions = {cue['id']: index for index, cue in enumerate(cues)}

    def partition(items, first, last, allow_sections):
        require(isinstance(items, list) and items, 'Missing chapter/section plan')
        result = []
        expected = first
        for item in items:
            require(isinstance(item, dict), 'Invalid chapter/section')
            require(all(isinstance(item.get(k), str) and item[k].strip() for k in ['titleZh', 'summaryZh']), 'Missing Chinese title or summary')
            start = positions.get(item.get('startCueId'))
            end = positions.get(item.get('endCueId'))
            require(start is not None and end is not None, 'Unknown source cue ID')
            require(start == expected and start <= end <= last, 'Cue ranges must cover the source in order without gaps or overlap')
            selected = cues[start:end + 1]
            chapter = {
                'titleZh': item['titleZh'].strip(), 'summaryZh': item['summaryZh'].strip(),
                'startCueId': selected[0]['id'], 'endCueId': selected[-1]['id'],
                'cueIds': [cue['id'] for cue in selected],
                'startMs': selected[0]['startMs'], 'endMs': max(c['endMs'] for c in selected),
                'jumpUrl': jump_url(transcript, selected[0]['startMs']),
            }
            if 'sections' in item:
                require(allow_sections, 'Only two directory levels are supported')
                chapter['sections'] = partition(item['sections'], start, end, False)
            result.append(chapter)
            expected = end + 1
        require(expected == last + 1, 'Chapter plan does not cover all source cues')
        return result

    chapters = partition(plan.get('chapters'), 0, len(cues) - 1, True)
    gaps = []
    covered_until = cues[0]['startMs']
    for cue in cues:
        if cue['startMs'] > covered_until:
            gaps.append({'startMs': covered_until, 'endMs': cue['startMs']})
        covered_until = max(covered_until, cue['endMs'])
    result = {
        'schemaVersion': 1, 'kind': 'video-notes-course-map', 'sessionId': transcript['sessionId'],
        'exportFile': export_file,
        'sourceSha256': source_sha256, 'sourceLanguage': transcript.get('languageCode', ''),
        'cueCount': len(cues), 'coverage': transcript['coverage'], 'gaps': gaps, 'chapters': chapters,
    }
    metadata = {
        '标题': transcript.get('title', '课程'), '类型': '课程地图', '平台': transcript['platform'],
        '原始网址': jump_url(transcript, 0), '导出文件': export_file,
        '整理时间': datetime.now().astimezone().isoformat(timespec='seconds'), '整理者': 'AI 整理',
        '状态': '待复核', 'tags': ['video-notes', 'course-map'],
    }
    lines = ['---', *[f'{key}: {json.dumps(value, ensure_ascii=False)}' for key, value in metadata.items()], '---', '',
             '# 课程中文地图（AI 整理）', '', escape(transcript.get('title', '课程')), '',
             f'覆盖 {len(cues)} 条来源字幕 · {timestamp(cues[0]["startMs"])}–{timestamp(covered_until)}', '',
             '目录和摘要由 AI 整理，时间来自原字幕；未与整段音频核验。', '']
    for index, chapter in enumerate(chapters, 1):
        lines += [f'## {index}. [{escape(chapter["titleZh"])}]({chapter["jumpUrl"]})', '',
                  f'{timestamp(chapter["startMs"])}–{timestamp(chapter["endMs"])} · {escape(chapter["summaryZh"])}', '']
        for section in chapter.get('sections', []):
            lines.append(f'- [{timestamp(section["startMs"])}–{timestamp(section["endMs"])} {escape(section["titleZh"])}]({section["jumpUrl"]})：{escape(section["summaryZh"])}')
        if chapter.get('sections'):
            lines.append('')
    if gaps:
        lines += ['> 来源字幕存在时间间隙；详细区间见配套 JSON，不能据此判断间隙中没有讲话。', '']
    return '\n'.join(lines), result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transcript', required=True, type=Path)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--export-file', required=True, help='Original ZIP filename, without its directory')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--json-output', required=True, type=Path)
    args = parser.parse_args()
    try:
        source = args.transcript.read_bytes()
        markdown, result = render_map(json.loads(source), json.loads(args.plan.read_text(encoding='utf-8')),
                                      hashlib.sha256(source).hexdigest(), args.export_file)
        paths = [args.output, args.json_output]
        require(len({p.resolve() for p in paths}) == 2, 'Output paths must be distinct')
        require(all(not p.exists() and not p.is_symlink() for p in paths), 'Output exists; refusing to overwrite')
        # Content is completely validated before any output is written.
        created = []
        try:
            for path, content in [(args.output, markdown), (args.json_output, json.dumps(result, ensure_ascii=False, indent=2) + '\n')]:
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('x', encoding='utf-8') as file:
                    created.append(path)
                    file.write(content)
        except Exception:
            for path in created:
                path.unlink()
            raise
        print(json.dumps({'chapters': len(result['chapters']), 'cue_count': result['cueCount'],
                          'markdown': str(args.output.resolve()), 'json': str(args.json_output.resolve())}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'MAP_ERROR: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
