"""Synthetic export fixtures; these checks do not assess AI translation quality."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'skills' / 'video-notes' / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import export_bundle as bundle
from find_unprocessed import discover, recorded_exports
from inspect_export import inspect_and_extract
from render_course_map import render_map

spec = importlib.util.spec_from_file_location('skill_installer', ROOT / 'scripts' / 'install-video-notes-skill.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def transcript():
    data = {
        'schemaVersion': 1, 'sessionId': 'youtube:synthetic', 'platform': 'youtube', 'videoId': 'synthetic',
        'part': 1, 'title': 'Synthetic <course>', 'languageCode': 'en', 'timingUnit': 'milliseconds',
        'segmentation': 'source-cues',
        'coverage': {'cueCount': 4, 'startMs': 1250.5, 'endMs': 3610123.25,
                     'completeness': 'source-track-not-verified-against-audio'},
        'cues': [
            {'id': 'cue-000001', 'startMs': 1250.5, 'endMs': 5000, 'text': 'What is a variable?'},
            {'id': 'cue-000002', 'startMs': 4500, 'endMs': 6000, 'text': 'A variable names a value.'},
            {'id': 'cue-000003', 'startMs': 3600000, 'endMs': 3610123.25, 'text': 'Let us work through an example.'},
            {'id': 'cue-000004', 'startMs': 3605000, 'endMs': 3607000, 'text': 'Review the result.'},
        ],
    }
    for cue in data['cues']:
        cue['jumpUrl'] = bundle.jump_url(data, cue['startMs'])
    return data


def chapter(start=1, end=4, **extra):
    return {'titleZh': '变量与例子', 'summaryZh': '解释变量并分析示例。',
            'startCueId': f'cue-{start:06}', 'endCueId': f'cue-{end:06}', **extra}


def export_files(data=None, included=True):
    data = data or transcript()
    files = {'课程笔记.md': '# Synthetic export\n\n本次无个人批注。'}
    manifest = {'schemaVersion': 1, 'kind': 'video-notes-export', 'notesFile': '课程笔记.md', 'noteCount': 0,
                'session': {'id': data['sessionId'], **{k: data[k] for k in ['platform', 'videoId', 'part']}},
                'transcript': {'status': 'unavailable', 'cueCount': 0}}
    if included:
        manifest['transcript'] = {'status': 'included', 'cueCount': len(data['cues']),
                                  'jsonFile': 'transcript/original.json', 'srtFile': 'transcript/original.srt',
                                  'markdownFile': 'transcript/original.md'}
        files.update({'transcript/original.json': json.dumps(data), 'transcript/original.srt': 'synthetic srt',
                      'transcript/original.md': '# Original source, not user notes'})
    files['export.json'] = json.dumps(manifest)
    return files


class SkillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def archive(self, files=None, filename='course.zip'):
        path = self.root / filename
        with zipfile.ZipFile(path, 'w') as archive:
            for name, content in (files or export_files()).items():
                archive.writestr(name, content)
        return path

    def render(self, plan=None, data=None):
        return render_map(data or transcript(), plan or {'chapters': [chapter()]}, 'source-hash', 'course.zip')

    def test_manifest_selects_main_note_including_zero_notes(self):
        report = bundle.inspect_archive(self.archive())
        self.assertEqual(report['notes_file'], '课程笔记.md')
        self.assertEqual(report['note_count'], 0)
        self.assertEqual(report['transcript']['coverage']['cueCount'], 4)

    def test_missing_full_transcript_remains_valid_export(self):
        report = bundle.inspect_archive(self.archive(export_files(included=False)))
        self.assertIsNone(report['transcript'])

    def test_legacy_recognition_and_ambiguous_notes(self):
        legacy = '# notes\n[00:01:02](https://www.youtube.com/watch?v=synthetic&t=62s)\n我的批注'
        report = bundle.inspect_archive(self.archive({'notes.md': legacy}))
        self.assertEqual(report['format'], 'legacy')
        self.assertIsNone(report['transcript'])
        with self.assertRaises(bundle.ExportError):
            bundle.inspect_archive(self.archive({'a.md': legacy, 'b.md': legacy}))

    def test_generic_zip_is_not_a_video_export(self):
        with self.assertRaises(bundle.ExportError):
            bundle.inspect_archive(self.archive({'YouTube-course.md': 'ordinary prose'}))

    def test_unsafe_paths_rejected_before_extracting(self):
        for name in ['../outside', '/absolute', 'a/../b', 'a//b', 'C:/escape', 'a\\b', 'CON.txt', 'dir./file']:
            with self.subTest(name=name):
                files = export_files()
                files[name] = 'untrusted'
                destination = self.root / 'extracted'
                with self.assertRaises(bundle.ExportError):
                    inspect_and_extract(self.archive(files), destination)
                self.assertFalse(destination.exists())

    def test_symlink_and_duplicate_paths_rejected(self):
        for mode in ['symlink', 'case', 'parent']:
            with self.subTest(mode=mode):
                path = self.archive()
                with zipfile.ZipFile(path, 'a') as archive:
                    if mode == 'symlink':
                        entry = zipfile.ZipInfo('link')
                        entry.create_system = 3
                        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                        archive.writestr(entry, '/outside')
                    elif mode == 'case':
                        archive.writestr('EXPORT.JSON', '{}')
                    else:
                        archive.writestr('transcript', 'file conflicts with directory')
                with self.assertRaises(bundle.ExportError):
                    bundle.inspect_archive(path)

    def test_size_and_entry_limits(self):
        path = self.archive()
        for key, limit in [('MAX_TOTAL_BYTES', 10), ('MAX_FILES', 1)]:
            with patch.object(bundle, key, limit), self.assertRaises(bundle.ExportError):
                bundle.inspect_archive(path)
        with zipfile.ZipFile(path) as archive, self.assertRaises(bundle.ExportError):
            bundle.read_text(archive, 'export.json', limit=1)

    def test_invalid_manifest_and_missing_files(self):
        for change in ['version', 'notes', 'transcript', 'identity', 'count', 'companion', 'distinct']:
            with self.subTest(change=change):
                files = export_files()
                manifest = json.loads(files['export.json'])
                if change == 'version': manifest['schemaVersion'] = 2
                if change == 'notes': manifest['notesFile'] = 'missing.md'
                if change == 'transcript': manifest['transcript']['status'] = 'partial'
                if change == 'identity': manifest['session']['id'] = 'youtube:other'
                if change == 'count': manifest['transcript']['cueCount'] = 999
                if change == 'companion': del files['transcript/original.srt']
                if change == 'distinct': manifest['notesFile'] = 'transcript/original.md'
                files['export.json'] = json.dumps(manifest)
                with self.assertRaises(bundle.ExportError):
                    bundle.inspect_archive(self.archive(files))

    def test_invalid_source_times_ids_and_links(self):
        mutations = [lambda d: d['cues'][0].update(startMs=-1),
                     lambda d: d['cues'][0].update(endMs=float('nan')),
                     lambda d: d['cues'][0].update(startMs=True),
                     lambda d: d['cues'][1].update(id=d['cues'][0]['id']),
                     lambda d: d['cues'][1].update(startMs=0),
                     lambda d: d['cues'][0].update(text=''),
                     lambda d: d['cues'][0].update(jumpUrl='https://example.com'),
                     lambda d: d['coverage'].update(cueCount=3)]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                data = transcript()
                mutate(data)
                with self.assertRaises(bundle.ExportError):
                    bundle.validate_transcript(data)

    def test_extraction_preserves_bytes_and_refuses_existing_directory(self):
        files = export_files()
        files['images/001.webp'] = b'\x00\xff synthetic binary'
        path = self.archive(files)
        before = path.read_bytes()
        dest = self.root / 'extract'
        report = inspect_and_extract(path, dest)
        self.assertEqual(report['extracted_to'], str(dest.resolve()))
        for name, content in files.items():
            self.assertEqual((dest / name).read_bytes(), content.encode() if isinstance(content, str) else content)
        with self.assertRaises(FileExistsError):
            inspect_and_extract(path, dest)
        self.assertEqual(path.read_bytes(), before)

    def test_map_uses_actual_times_with_overlapping_cues_and_hour_boundary(self):
        markdown, result = self.render({'chapters': [chapter(1, 2), chapter(3, 4)]})
        self.assertEqual(result['chapters'][0]['startMs'], 1250.5)
        self.assertEqual(result['chapters'][1]['endMs'], 3610123.25)
        self.assertEqual(result['chapters'][1]['jumpUrl'], 'https://www.youtube.com/watch?v=synthetic&t=3600s')
        self.assertEqual(result['gaps'], [{'startMs': 6000, 'endMs': 3600000}])
        self.assertIn('01:00:00–01:00:10', markdown)
        self.assertNotIn('<course>', markdown.split('\n---\n', 1)[1])
        self.assertIn('导出文件: "course.zip"', markdown)
        self.assertIn('状态: "待复核"', markdown)

    def test_map_supports_two_levels_and_bilibili_part(self):
        data = transcript()
        data.update(platform='bilibili', videoId='BVsynthetic', part=2, sessionId='bilibili:BVsynthetic:2')
        for cue in data['cues']: cue['jumpUrl'] = bundle.jump_url(data, cue['startMs'])
        _, result = self.render({'chapters': [chapter(sections=[chapter(1, 2), chapter(3, 4)])]}, data)
        self.assertTrue(result['chapters'][0]['sections'][1]['jumpUrl'].endswith('?p=2&t=3600'))

    def test_map_rejects_missing_overlap_unknown_and_excess_levels(self):
        for chapters in [[chapter(2, 4)], [chapter(1, 2), chapter(2, 4)], [chapter(1, 3)],
                         [chapter(1, 5)], [chapter(3, 4), chapter(1, 2)],
                         [chapter(sections=[chapter(1, 2)])],
                         [chapter(sections=[chapter(sections=[chapter()])])], [chapter(titleZh='')]]:
            with self.subTest(chapters=chapters), self.assertRaises(bundle.ExportError):
                self.render({'chapters': chapters})

    def test_cli_renders_provenance_and_does_not_overwrite(self):
        source = self.root / 'original.json'
        plan = self.root / 'plan.json'
        md, output = self.root / '地图.md', self.root / '地图.json'
        source.write_text(json.dumps(transcript()), encoding='utf-8')
        plan.write_text(json.dumps({'chapters': [chapter()]}), encoding='utf-8')
        args = [sys.executable, str(SCRIPTS / 'render_course_map.py'), '--transcript', str(source), '--plan', str(plan),
                '--export-file', 'course.zip', '--output', str(md), '--json-output', str(output)]
        completed = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        data = json.loads(output.read_text())
        self.assertEqual(data['sourceSha256'], hashlib.sha256(source.read_bytes()).hexdigest())
        md.unlink()
        before = output.read_bytes()
        completed = subprocess.run(args, capture_output=True, text=True)
        self.assertNotEqual(completed.returncode, 0)
        self.assertFalse(md.exists())
        self.assertEqual(output.read_bytes(), before)

    def test_discovery_selects_newest_valid_unprocessed_only(self):
        older = self.archive(filename='older.zip')
        newer = self.archive(filename='newer.zip')
        invalid = self.archive({'ordinary.md': 'hello'}, filename='video-notes.zip')
        for index, path in enumerate([older, newer, invalid]): os.utime(path, (index + 1, index + 1))
        notes = self.root / 'notes'
        notes.mkdir()
        (notes / 'done.md').write_text('---\n导出文件: "newer.zip"\n状态: 已整理\n---\n', encoding='utf-8')
        (notes / 'body.md').write_text('正文例子\n导出文件: older.zip\n', encoding='utf-8')
        (notes / 'pending.md').write_text('---\n导出文件: older.zip\n状态: "待复核"\n---\n', encoding='utf-8')
        exports = discover(self.root, recorded_exports(notes))
        self.assertEqual([(e.filename, e.status) for e in exports], [('newer.zip', 'processed'), ('older.zip', 'unprocessed')])

    def test_install_preserves_existing_skill_in_backup(self):
        skills = self.root / 'skills'
        target = skills / 'video-notes'
        target.mkdir(parents=True)
        (target / 'SKILL.md').write_text('personal instructions')
        (target / 'custom.txt').write_text('keep me')
        result = installer.install(ROOT / 'skills' / 'video-notes', skills)
        backup = Path(result['backup'])
        self.assertEqual((backup / 'custom.txt').read_text(), 'keep me')
        self.assertEqual((backup / 'SKILL.md').read_text(), 'personal instructions')
        self.assertEqual((target / 'SKILL.md').read_bytes(), (ROOT / 'skills' / 'video-notes' / 'SKILL.md').read_bytes())
        self.assertTrue((target / 'scripts' / 'export_bundle.py').is_file())
        self.assertFalse(list(target.rglob('__pycache__')))

    def test_install_without_prior_skill_and_reject_symlink(self):
        skills = self.root / 'skills'
        result = installer.install(ROOT / 'skills' / 'video-notes', skills)
        self.assertIsNone(result['backup'])
        elsewhere = self.root / 'linked-skills'
        elsewhere.mkdir()
        (elsewhere / 'video-notes').symlink_to(skills / 'video-notes', target_is_directory=True)
        with self.assertRaises(ValueError): installer.install(ROOT / 'skills' / 'video-notes', elsewhere)

    def test_failed_install_rolls_back_previous_copy(self):
        skills = self.root / 'skills'
        target = skills / 'video-notes'
        target.mkdir(parents=True)
        (target / 'SKILL.md').write_text('original')
        original_rename = Path.rename

        def fail_staged_rename(path, destination):
            if path.parent.name.startswith('.video-notes-install-'):
                raise OSError('synthetic install failure')
            return original_rename(path, destination)

        with patch.object(Path, 'rename', fail_staged_rename), self.assertRaises(OSError):
            installer.install(ROOT / 'skills' / 'video-notes', skills)
        self.assertEqual((target / 'SKILL.md').read_text(), 'original')
        self.assertEqual(list(skills.iterdir()), [target])


if __name__ == '__main__':
    unittest.main()
