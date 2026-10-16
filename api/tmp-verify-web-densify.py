#!/usr/bin/env python3
"""Measure density and verify comment-only vs git HEAD for scoped web files."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(r"c:\Users\Admin\Desktop\maintenance")
SRC = ROOT / "web" / "src"

SCOPE: list[Path] = []
for rel in [
    "pages/NotificationsPage.tsx",
    "pages/PermissionsPage.tsx",
    "pages/ResultsPage.tsx",
    "pages/RoomQrPage.tsx",
    "pages/RoomsPage.tsx",
    "pages/CommonAreasPage.tsx",
    "pages/TeamPage.tsx",
]:
    SCOPE.append(SRC / rel)
for d in ["pages/plan", "pages/RepairsPage", "pages/SettingsPage", "components"]:
    SCOPE.extend((SRC / d).rglob("*.tsx"))
    SCOPE.extend((SRC / d).rglob("*.ts"))

seen: set[str] = set()
FILES: list[Path] = []
for f in SCOPE:
    k = str(f.resolve())
    if k not in seen and f.is_file():
        seen.add(k)
        FILES.append(f)


def is_comment_line(s: str) -> bool:
    t = s.strip()
    if not t:
        return False
    return (
        t.startswith("//")
        or t.startswith("/*")
        or t.startswith("*")
        or t.startswith("{/*")
        or t.endswith("*/}")
        or t == "*/"
    )


def density(text: str) -> tuple[float, int, int]:
    comment = code = 0
    for line in text.splitlines():
        if not line.strip():
            continue
        code += 1
        if is_comment_line(line):
            comment += 1
    return (comment / code if code else 0.0), code, comment


def strip_comments(text: str) -> str:
    text = re.sub(r"\{\s*/\*[\s\S]*?\*/\s*\}", "", text)
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    out: list[str] = []
    for line in text.splitlines():
        in_str = False
        quote = ""
        buf: list[str] = []
        i = 0
        while i < len(line):
            ch = line[i]
            if in_str:
                buf.append(ch)
                if ch == "\\" and i + 1 < len(line):
                    buf.append(line[i + 1])
                    i += 2
                    continue
                if ch == quote:
                    in_str = False
                i += 1
                continue
            if ch in ('"', "'", "`"):
                in_str = True
                quote = ch
                buf.append(ch)
                i += 1
                continue
            if ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
                break
            buf.append(ch)
            i += 1
        out.append("".join(buf).rstrip())
    return "\n".join(l for l in out if l.strip())


def main() -> int:
    print("=== DENSITY (non-blank lines) ===")
    low: list[str] = []
    samples: list[tuple[float, str, int, int]] = []
    for f in sorted(FILES):
        d, code, c = density(f.read_text(encoding="utf-8"))
        rel = f.relative_to(SRC).as_posix()
        flag = " ***LOW***" if code >= 80 and d < 0.12 else ""
        print(f"{d:.3f}  code={code:4d}  c={c:3d}  {rel}{flag}")
        if code >= 80:
            samples.append((d, rel, code, c))
        if code >= 80 and d < 0.12:
            low.append(rel)

    print("\n=== SAMPLE before/after (current; before was ~0.02-0.11) ===")
    for d, rel, code, c in sorted(samples, key=lambda x: x[0])[:8]:
        print(f"  {rel}: now {d:.3f} (code={code}, comments={c})")
    for d, rel, code, c in sorted(samples, key=lambda x: -x[0])[:5]:
        print(f"  {rel}: now {d:.3f} (code={code}, comments={c})")

    print("\n=== COMMENT-ONLY vs HEAD ===")
    bad: list[str] = []
    skipped = 0
    for f in sorted(FILES):
        rel = f.relative_to(ROOT).as_posix()
        try:
            old = subprocess.check_output(
                ["git", "show", f"HEAD:{rel}"],
                cwd=str(ROOT),
                text=True,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            skipped += 1
            continue
        new = f.read_text(encoding="utf-8")
        if strip_comments(old) != strip_comments(new):
            bad.append(rel)
            print(f"LOGIC DIFF: {rel}")
        else:
            print(f"OK {rel}")
    print(f"\nlow_ge80={len(low)} logic_diffs={len(bad)} skipped_untracked_or_new={skipped}")
    if low:
        print("STILL LOW:", low)
    return 1 if low or bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
