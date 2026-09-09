#!/usr/bin/env python3
"""Install the repository skill, preserving any previous copy in skill-backups."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1] / 'skills' / 'video-notes'


def install(source, skills_dir):
    source = source.resolve()
    skills_dir = skills_dir.expanduser().resolve()
    target = skills_dir / 'video-notes'
    if not (source / 'SKILL.md').is_file():
        raise ValueError('Source skill is missing SKILL.md')
    if target.resolve() == source or source in target.resolve().parents or target.resolve() in source.parents:
        raise ValueError('Source and install location must not overlap')
    if target.is_symlink() or (target.exists() and not target.is_dir()):
        raise ValueError('Install target must be a regular directory, not a file or symlink')
    skills_dir.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.video-notes-install-', dir=skills_dir))
    backup = None
    try:
        shutil.copytree(source, staging / 'video-notes', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        if target.exists():
            backup_root = skills_dir.parent / 'skill-backups'
            backup_root.mkdir(parents=True, exist_ok=True)
            backup_container = Path(tempfile.mkdtemp(prefix=f'video-notes-{datetime.now():%Y%m%d-%H%M%S}-', dir=backup_root))
            backup = backup_container / 'video-notes'
            target.rename(backup)
        try:
            (staging / 'video-notes').rename(target)
        except Exception:
            if backup is not None:
                backup.rename(target)
            raise
    finally:
        shutil.rmtree(staging)
    return {'installed': str(target), 'backup': str(backup) if backup else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    default_home = Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex')
    parser.add_argument('--skills-dir', type=Path, default=default_home / 'skills')
    args = parser.parse_args()
    try:
        print(json.dumps(install(SOURCE, args.skills_dir), ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError) as error:
        print(f'INSTALL_ERROR: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
