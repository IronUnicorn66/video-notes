#!/usr/bin/env python3
"""Inspect a video-note ZIP and optionally extract into a new directory."""
import argparse
import json
import shutil
import sys
import zipfile
from pathlib import Path

from export_bundle import inspect_archive


def inspect_and_extract(path, destination=None):
    report = inspect_archive(path)
    if destination is not None:
        destination = Path(destination)
        destination.mkdir(parents=True, exist_ok=False)
        try:
            with zipfile.ZipFile(path) as archive:
                for name in report['files']:
                    target = destination / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(name) as source, target.open('xb') as output:
                        shutil.copyfileobj(source, output)
            report['extracted_to'] = str(destination.resolve())
        except Exception:
            shutil.rmtree(destination)
            raise
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip', type=Path)
    parser.add_argument('--extract-to', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect_and_extract(args.zip, args.extract_to), ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, zipfile.BadZipFile, NotImplementedError) as error:
        print(f'EXPORT_ERROR: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
