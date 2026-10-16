#!/usr/bin/env python3
"""Move JSX comments that sit illegally as siblings after '(' openers."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(r"c:\Users\Admin\Desktop\maintenance\web\src")
FILES = list((ROOT / "components").rglob("*.tsx")) + list(
    (ROOT / "pages").rglob("*.tsx")
)

OPEN_RE = re.compile(r"\(\s*$")
SKIP_RE = re.compile(
    r"^\s*(export\s+)?(async\s+)?function\b|^\s*(const|let|var)\s+\w+.*=\s*\(\s*$"
)


def fix(path: Path) -> int:
    lines = path.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    i = 0
    moved = 0
    while i < len(lines):
        line = lines[i]
        if OPEN_RE.search(line.rstrip()) and not SKIP_RE.search(line):
            j = i + 1
            comments: list[str] = []
            while j < len(lines) and lines[j].strip().startswith("{/*"):
                comments.append(lines[j])
                j += 1
            if comments and j < len(lines):
                nxt = lines[j].strip()
                if nxt.startswith("<") or (
                    nxt.startswith("{") and not nxt.startswith("{/*")
                ):
                    ind = line[: len(line) - len(line.lstrip(" \t"))]
                    for c in comments:
                        out.append(ind + c.strip())
                        moved += 1
                    out.append(line)
                    i = j
                    continue
        out.append(line)
        i += 1
    if moved:
        path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    return moved


def scan(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    issues: list[str] = []
    for i, line in enumerate(lines):
        if not OPEN_RE.search(line.rstrip()) or SKIP_RE.search(line):
            continue
        j = i + 1
        if j < len(lines) and lines[j].strip().startswith("{/*"):
            issues.append(
                f"{path.relative_to(ROOT)}:{i+1}: {line.strip()[:60]}"
            )
    return issues


def main() -> None:
    total = 0
    for path in FILES:
        m = fix(path)
        if m:
            print(f"fixed {m}: {path.relative_to(ROOT)}")
            total += m
    print(f"total moved={total}")
    left: list[str] = []
    for path in FILES:
        left.extend(scan(path))
    print(f"remaining issues={len(left)}")
    for x in left[:30]:
        print(x)


if __name__ == "__main__":
    main()
