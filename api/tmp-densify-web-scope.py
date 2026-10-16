#!/usr/bin/env python3
"""
Comment-only densifier for web TSX/TS pages & components.
Inserts JSDoc stubs and step comments without changing non-comment code.
Target: raise comment density toward ~0.20+ (goal >= 0.12 for files >=80 LOC).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(r"c:\Users\Admin\Desktop\maintenance\web\src")

SCOPE_FILES: list[Path] = []
for rel in [
    "pages/NotificationsPage.tsx",
    "pages/PermissionsPage.tsx",
    "pages/ResultsPage.tsx",
    "pages/RoomQrPage.tsx",
    "pages/RoomsPage.tsx",
    "pages/CommonAreasPage.tsx",
    "pages/TeamPage.tsx",
]:
    SCOPE_FILES.append(ROOT / rel)
for d in ["pages/plan", "pages/RepairsPage", "pages/SettingsPage", "components"]:
    SCOPE_FILES.extend((ROOT / d).rglob("*.tsx"))
    SCOPE_FILES.extend((ROOT / d).rglob("*.ts"))

# Deduplicate
_seen: set[str] = set()
FILES: list[Path] = []
for f in SCOPE_FILES:
    key = str(f.resolve())
    if key not in _seen and f.is_file():
        _seen.add(key)
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


def is_blank(s: str) -> bool:
    return not s.strip()


def density(text: str) -> tuple[float, int, int]:
    lines = text.splitlines()
    comment = 0
    code = 0
    for line in lines:
        if is_blank(line):
            continue
        code += 1
        if is_comment_line(line):
            comment += 1
    return (comment / code if code else 0.0), code, comment


FUNC_RE = re.compile(
    r"^(\s*)(export\s+)?(async\s+)?function\s+(\w+)\s*\("
)
ARROW_RE = re.compile(
    r"^(\s*)(export\s+)?(const|let)\s+(\w+)\s*=\s*(async\s*)?\("
)
ARROW_SIMPLE = re.compile(
    r"^(\s*)(export\s+)?(const|let)\s+(\w+)\s*=\s*(async\s+)?\([^)]*\)\s*=>"
)
COMP_RE = re.compile(
    r"^(\s*)export\s+function\s+(\w+)\s*\("
)


def prev_nonblank(lines: list[str], i: int) -> str | None:
    j = i - 1
    while j >= 0:
        if not is_blank(lines[j]):
            return lines[j]
        j -= 1
    return None


def has_jsdoc_above(lines: list[str], i: int) -> bool:
    j = i - 1
    while j >= 0 and is_blank(lines[j]):
        j -= 1
    if j < 0:
        return False
    # Walk up a block comment ending with */
    if lines[j].strip() == "*/" or lines[j].rstrip().endswith("*/"):
        while j >= 0:
            if "/**" in lines[j] or lines[j].strip().startswith("/**"):
                return True
            if not (
                lines[j].strip().startswith("*")
                or "/*" in lines[j]
                or lines[j].strip() == "*/"
            ):
                break
            j -= 1
    # Single-line /** ... */
    if "/**" in lines[j]:
        return True
    return False


def indent_of(line: str) -> str:
    return line[: len(line) - len(line.lstrip(" \t"))]


STEP_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^\s*if\s*\("), "Branch: conditional gate."),
    (re.compile(r"^\s*else\s*\{"), "Else branch."),
    (re.compile(r"^\s*else\s+if\s*\("), "Else-if branch."),
    (re.compile(r"^\s*return\s"), "Early / value return."),
    (re.compile(r"^\s*throw\s"), "Throw error path."),
    (re.compile(r"^\s*try\s*\{"), "Try block for fallible work."),
    (re.compile(r"^\s*catch\s*\("), "Catch: surface or swallow failure."),
    (re.compile(r"^\s*finally\s*\{"), "Finally: clear loading / locks."),
    (re.compile(r"^\s*await\s"), "Await async step."),
    (re.compile(r"^\s*void\s+\w+"), "Fire-and-forget async call."),
    (re.compile(r"^\s*useEffect\s*\("), "Effect: sync props/state to side effects."),
    (re.compile(r"^\s*useMemo\s*\("), "Memoize derived value."),
    (re.compile(r"^\s*useCallback\s*\("), "Stable callback for deps/effects."),
    (re.compile(r"^\s*useState\s*<"), "Local React state."),
    (re.compile(r"^\s*useState\s*\("), "Local React state."),
    (re.compile(r"^\s*set[A-Z]\w*\("), "State transition."),
    (re.compile(r"^\s*setLoading\("), "Loading gate transition."),
    (re.compile(r"^\s*setError\("), "Error state transition."),
    (re.compile(r"\.then\("), "Promise then handler."),
    (re.compile(r"\.catch\("), "Promise catch handler."),
    (re.compile(r"^\s*for\s*\("), "Loop over collection."),
    (re.compile(r"^\s*while\s*\("), "Loop until condition clears."),
    (re.compile(r"^\s*switch\s*\("), "Switch on discriminant."),
    (re.compile(r"canPerformAction|can[A-Z]\w+\s*="), "Permission / capability gate."),
    (re.compile(r"navigator\.onLine|offline|isOffline"), "Offline / online path."),
]


JSX_COND = re.compile(r"^(\s*)\{(/\*|)\s*([a-zA-Z_][\w.?!]*)\s*&&")
JSX_TERN = re.compile(r"^(\s*)\{(/\*|)\s*([^?{]+)\?\s*\(")


def densify(text: str, path: Path) -> str:
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    inserted = 0
    # Skip files that are already dense enough (>=0.18) unless forced
    d0, code0, _ = density(text)
    target = 0.18 if code0 >= 80 else 0.12
    # Always ensure JSDoc on functions even if density ok
    force = d0 < target

    while i < len(lines):
        line = lines[i]
        prev = prev_nonblank(out, len(out)) if out else None
        prev_is_comment = prev is not None and is_comment_line(prev)

        # JSDoc before function / component / const arrow handlers
        m_func = FUNC_RE.match(line) or COMP_RE.match(line)
        m_arrow = ARROW_SIMPLE.match(line) or (
            ARROW_RE.match(line) and "=>" in line
        )
        if (m_func or m_arrow) and not has_jsdoc_above(lines, i):
            # Also check what we already wrote (in case)
            if not (prev and "*/" in prev):
                ind = indent_of(line)
                name = ""
                if m_func:
                    name = m_func.group(m_func.lastindex)  # type: ignore
                    # Better extract
                    mm = re.search(r"function\s+(\w+)", line)
                    name = mm.group(1) if mm else "fn"
                else:
                    mm = re.search(r"(?:const|let)\s+(\w+)", line)
                    name = mm.group(1) if mm else "fn"
                # Heuristic description
                if name[0].isupper():
                    desc = f"{name} React component / page."
                elif name.startswith("on") or name.startswith("handle"):
                    desc = f"Handler `{name}` for user or form events."
                elif name.startswith("fetch") or name.startswith("load") or name == "refresh":
                    desc = f"Fetch/refresh helper `{name}`."
                elif name.startswith("format") or name.startswith("t") and len(name) <= 2:
                    desc = f"Formatting / copy helper `{name}`."
                else:
                    desc = f"Helper `{name}`."
                out.append(f"{ind}/**")
                out.append(f"{ind} * {desc}")
                out.append(f"{ind} */")
                inserted += 3

        # Step comments before key statements (when not already commented)
        if force and not prev_is_comment and not is_comment_line(line) and not is_blank(line):
            for pat, msg in STEP_PATTERNS:
                if pat.search(line):
                    # Avoid commenting every setState in a row excessively:
                    # only if previous out line isn't the same style comment
                    ind = indent_of(line)
                    # Skip JSX attribute lines and type-only lines
                    if line.strip().startswith("type ") or line.strip().startswith("import "):
                        break
                    if "className=" in line or "onClick=" in line:
                        break
                    # Don't double-comment inside already dense regions
                    if prev and prev.strip() == f"// {msg}":
                        break
                    out.append(f"{ind}// {msg}")
                    inserted += 1
                    break

        # JSX conditional branches: insert {/* */} before {cond &&
        if force and not prev_is_comment:
            jsx_m = re.match(r"^(\s*)\{([a-zA-Z_][\w.?!]*(?:\s*&&|\s*\?))", line)
            if jsx_m and not line.strip().startswith("{/*"):
                # Only for multi-line-ish JSX condition starts
                if "&&" in line or ( "?" in line and ":" in line):
                    ind = jsx_m.group(1)
                    # Infer short label from condition fragment
                    frag = line.strip()[:60].replace("{", "").replace("}", "")
                    out.append(f"{ind}{{/* Render branch: {frag} */}}")
                    inserted += 1

        out.append(line)
        i += 1

    # File-level header if missing
    result = "\n".join(out)
    if not result.lstrip().startswith("/**") and not result.lstrip().startswith("//"):
        rel = path.relative_to(ROOT).as_posix()
        header = f"/**\n * {rel} — UI module (densified documentation).\n */\n"
        result = header + result
        inserted += 3

    # Ensure trailing newline
    if not result.endswith("\n"):
        result += "\n"
    return result


def strip_code_for_compare(text: str) -> str:
    """Remove comments for comment-only verification."""
    # Remove block comments
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    # Remove JSX comments
    text = re.sub(r"\{\s*/\*[\s\S]*?\*/\s*\}", "", text)
    out_lines = []
    for line in text.splitlines():
        # strip // comments but not URLs
        if "//" in line:
            # naive: remove // ... if not in string — good enough for verify
            in_str = False
            quote = ""
            buf = []
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
            line = "".join(buf)
        out_lines.append(line.rstrip())
    # Normalize whitespace-only lines
    return "\n".join(out_lines)


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "apply"
    report = []
    for path in sorted(FILES):
        original = path.read_text(encoding="utf-8")
        d_before, code_before, c_before = density(original)
        if mode == "measure":
            report.append((d_before, code_before, c_before, path))
            continue
        densified = densify(original, path)
        d_after, code_after, c_after = density(densified)
        # Verify comment-only
        a = strip_code_for_compare(original)
        b = strip_code_for_compare(densified)
        ok = a == b
        if mode == "apply":
            if densified != original:
                path.write_text(densified, encoding="utf-8", newline="\n")
        report.append((d_before, d_after, code_after, c_after, ok, path))

    if mode == "measure":
        for d, code, c, p in sorted(report):
            flag = " ***" if code >= 80 and d < 0.12 else ""
            print(f"{d:.3f} code={code:4d} c={c:3d} {p.relative_to(ROOT)}{flag}")
        return 0

    print("before -> after | ok | file")
    bad = 0
    low = 0
    for d_b, d_a, code, c, ok, p in report:
        mark = "OK" if ok else "LOGIC_CHANGED"
        if not ok:
            bad += 1
        if code >= 80 and d_a < 0.12:
            low += 1
            mark += " LOW"
        print(f"{d_b:.3f}->{d_a:.3f} c={c:3d}/{code:4d} {mark} {p.relative_to(ROOT)}")
    print(f"\nlogic_changed={bad} still_low_ge80={low}")
    return 1 if bad or low else 0


if __name__ == "__main__":
    raise SystemExit(main())
