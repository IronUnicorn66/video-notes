#!/usr/bin/env python3
"""Find video-note ZIP exports that are not recorded in imported Markdown."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from export_bundle import inspect_archive


EXPORT_FIELD = re.compile(
    r"^\s*导出文件\s*:\s*[\"']?(?P<name>.+?\.zip)[\"']?\s*$",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass(frozen=True)
class Export:
    path: str
    filename: str
    modified: str
    size: int
    status: str
    reason: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--downloads", type=Path, default=Path.home() / "Downloads")
    parser.add_argument("--vault-root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--notes-dir",
        default=None,
        help="Vault-relative directory containing imported Markdown notes",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    return parser.parse_args()


def recorded_exports(notes_dir: Path) -> dict[str, str]:
    recorded: dict[str, str] = {}
    if not notes_dir.is_dir():
        return recorded

    for note in notes_dir.rglob("*.md"):
        try:
            text = note.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        frontmatter = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.DOTALL)
        if not frontmatter:
            continue
        if re.search(r'^\s*状态\s*:\s*["\']?(?:待复核|部分整理)["\']?\s*$', frontmatter[1], re.MULTILINE):
            continue
        for match in EXPORT_FIELD.finditer(frontmatter[1]):
            recorded[Path(match.group("name")).name] = str(note)
    return recorded


def looks_like_video_export(path: Path) -> tuple[bool, str]:
    try:
        report = inspect_archive(path)
        return True, "已验证新版导出清单" if report["format"] == "v1" else "已验证旧版视频批注"
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, zipfile.BadZipFile, NotImplementedError):
        return False, "无效或不安全的视频笔记导出"


def discover(downloads: Path, recorded: dict[str, str]) -> list[Export]:
    exports: list[Export] = []
    if not downloads.is_dir():
        return exports

    candidates = sorted(
        downloads.glob("*.zip"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    for path in candidates:
        matched, reason = looks_like_video_export(path)
        if not matched:
            continue
        stat = path.stat()
        if path.name in recorded:
            status = "processed"
            reason = f"已记录于 {recorded[path.name]}"
        else:
            status = "unprocessed"
        exports.append(
            Export(
                path=str(path),
                filename=path.name,
                modified=datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(timespec="seconds"),
                size=stat.st_size,
                status=status,
                reason=reason,
            )
        )
    return exports


def main() -> int:
    args = parse_args()
    vault_root = args.vault_root.expanduser().resolve()
    legacy = "01原始资料/00批注笔记"
    notes_dir = vault_root / (args.notes_dir or (legacy if (vault_root / legacy).is_dir() else "Video Notes"))
    recorded = recorded_exports(notes_dir)
    exports = discover(args.downloads.expanduser().resolve(), recorded)

    if args.json:
        payload = {
            "latest_unprocessed": next(
                (asdict(item) for item in exports if item.status == "unprocessed"),
                None,
            ),
            "exports": [asdict(item) for item in exports],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    unprocessed = [item for item in exports if item.status == "unprocessed"]
    if unprocessed:
        latest = unprocessed[0]
        print(f"LATEST_UNPROCESSED\t{latest.path}\t{latest.reason}")
    else:
        print("NO_UNPROCESSED_VIDEO_NOTES")
    for item in exports:
        print(f"{item.status.upper()}\t{item.path}\t{item.reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
