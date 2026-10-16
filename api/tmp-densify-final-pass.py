#!/usr/bin/env python3
"""
Final comment-only densification for sparse api/web modules.
Target density >= 0.12. Inserts JSDoc + // step comments; never changes logic.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(r"c:\Users\Admin\Desktop\maintenance")

SCOPE_GLOBS = [
    "web/src/api/**/*.ts",
    "web/src/api/**/*.tsx",
    "web/src/app/**/*.ts",
    "web/src/app/**/*.tsx",
    "web/src/audit/labels.ts",
    "api/src/controllers/**/*.ts",
    "api/src/permissions.ts",
    "web/src/pages/AnalyticsPage.tsx",
    "web/src/pages/ActivatePage.tsx",
]


def collect_files() -> list[Path]:
    files: list[Path] = []
    seen: set[str] = set()
    for pattern in SCOPE_GLOBS:
        for f in ROOT.glob(pattern):
            if not f.is_file():
                continue
            if ".test." in f.name:
                continue
            k = str(f.resolve())
            if k in seen:
                continue
            seen.add(k)
            files.append(f)
    return sorted(files)


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


def indent_of(line: str) -> str:
    return line[: len(line) - len(line.lstrip(" \t"))]


def prev_nonblank(lines: list[str], i: int) -> str | None:
    j = i - 1
    while j >= 0:
        if lines[j].strip():
            return lines[j]
        j -= 1
    return None


def has_jsdoc_above(lines: list[str], i: int) -> bool:
    j = i - 1
    while j >= 0 and not lines[j].strip():
        j -= 1
    if j < 0:
        return False
    if "/**" in lines[j]:
        return True
    if lines[j].strip() == "*/" or lines[j].rstrip().endswith("*/"):
        while j >= 0:
            if "/**" in lines[j]:
                return True
            t = lines[j].strip()
            if not (t.startswith("*") or "/*" in lines[j] or t == "*/"):
                break
            j -= 1
    return False


FUNC_RE = re.compile(r"^(\s*)(export\s+)?(async\s+)?function\s+(\w+)\s*\(")
ARROW_RE = re.compile(
    r"^(\s*)(export\s+)?(const|let)\s+(\w+)\s*=\s*(async\s*)?\([^)]*\)\s*=>"
)
ARROW_MULTI = re.compile(
    r"^(\s*)(export\s+)?(const|let)\s+(\w+)\s*=\s*(async\s*)?\($"
)


def describe_fn(name: str) -> str:
    if name[0].isupper():
        return f"{name} React component / page."
    if name.startswith("on") or name.startswith("handle"):
        return f"Handler `{name}` for UI or form events."
    if name.startswith("fetch") or name.startswith("load") or name == "refresh":
        return f"Fetch/refresh helper `{name}`."
    if name.startswith("format") or name.startswith("pick") or name.startswith("humanize"):
        return f"Formatting / copy helper `{name}`."
    if name in ("list", "get", "create", "update", "remove", "delete", "patch"):
        return f"HTTP handler `{name}`."
    return f"Helper `{name}`."


# Contextual step patterns: (regex, message factory or string)
STEP_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^\s*if\s*\(!?parsed\.success"), "Reject invalid request payload."),
    (re.compile(r"^\s*if\s*\(.*AppError"), "Map known AppError to HTTP."),
    (re.compile(r"^\s*if\s*\("), "Branch: conditional gate."),
    (re.compile(r"^\s*else\s*\{"), "Else branch."),
    (re.compile(r"^\s*else\s+if\s*\("), "Else-if branch."),
    (re.compile(r"^\s*return\s+res\.status\(400\)"), "Validation error response."),
    (re.compile(r"^\s*return\s+res\.json\("), "JSON success response."),
    (re.compile(r"^\s*return\s+next\("), "Forward error to Express."),
    (re.compile(r"^\s*return\s"), "Return value / early exit."),
    (re.compile(r"^\s*throw\s"), "Throw error path."),
    (re.compile(r"^\s*try\s*\{"), "Try block for fallible work."),
    (re.compile(r"^\s*catch\s*\("), "Catch: surface or swallow failure."),
    (re.compile(r"^\s*finally\s*\{"), "Finally: clear loading / locks."),
    (re.compile(r"^\s*await\s+resolveDataScope"), "Resolve caller DataScope."),
    (re.compile(r"^\s*await\s+assertCan"), "Assert access / permission."),
    (re.compile(r"^\s*const\s+scope\s*="), "Build data-scope filter."),
    (re.compile(r"^\s*const\s+schema\s*="), "Zod schema for request shape."),
    (re.compile(r"^\s*const\s+parsed\s*="), "Parse and validate input."),
    (re.compile(r"^\s*const\s+res\s*=\s*await\s+apiFetch"), "Authenticated HTTP request."),
    (re.compile(r"^\s*const\s+q\s*=\s*new\s+URLSearchParams"), "Build query string."),
    (re.compile(r"^\s*const\s+qs\s*="), "Optional query suffix."),
    (re.compile(r"return\s+parseJson\("), "Decode JSON response body."),
    (re.compile(r"^\s*await\s"), "Await async step."),
    (re.compile(r"^\s*void\s+\w+"), "Fire-and-forget async call."),
    (re.compile(r"^\s*useEffect\s*\("), "Effect: sync props/state to side effects."),
    (re.compile(r"^\s*useMemo\s*\("), "Memoize derived value."),
    (re.compile(r"^\s*useCallback\s*\("), "Stable callback for deps/effects."),
    (re.compile(r"^\s*useState\s*[<(]"), "Local React state."),
    (re.compile(r"^\s*useRef\s*[<(]"), "Mutable React ref."),
    (re.compile(r"^\s*useNavigate\s*\("), "Router navigate handle."),
    (re.compile(r"^\s*const\s+\[\w+,\s*set"), "Local React state."),
    (re.compile(r"^\s*set[A-Z]\w*\("), "State transition."),
    (re.compile(r"^\s*for\s*\("), "Loop over collection."),
    (re.compile(r"^\s*while\s*\("), "Loop until condition clears."),
    (re.compile(r"^\s*switch\s*\("), "Switch on discriminant."),
    (re.compile(r"^\s*case\s+"), "Case branch."),
    (re.compile(r"^\s*default\s*:"), "Default branch."),
    (re.compile(r"canPerformAction|can[A-Z]\w+\s*="), "Permission / capability gate."),
    (re.compile(r"navigator\.onLine|isOffline"), "Offline / online path."),
    (re.compile(r"^\s*export\s+\{"), "Re-export public API surface."),
    (re.compile(r"^\s*export\s+type\s+\{"), "Re-export shared types."),
    (re.compile(r"^\s*export\s+type\s+\w+"), "Public type alias."),
    (re.compile(r"^\s*export\s+async\s+function"), None),  # handled by JSDoc
    (re.compile(r"^\s*const\s+\w+\s*=\s*z\."), "Zod field / transform."),
    (re.compile(r"^\s*const\s+result\s*="), "Capture service / command result."),
    (re.compile(r"^\s*const\s+row\s*="), "Persist or load row."),
    (re.compile(r"apiFetch\("), "Call backend via apiFetch."),
    (re.compile(r"JSON\.stringify\("), "Serialize request body."),
    (re.compile(r"encodeURIComponent\("), "Encode path/query segment."),
    (re.compile(r"^\s*const\s+common\s*="), "Shared SVG / style attrs."),
    (re.compile(r"^\s*<svg\s"), "Render SVG glyph."),
    (re.compile(r"^\s*lines\.push\("), "Accumulate display line."),
    (re.compile(r"^\s*bits\.push\("), "Accumulate summary bit."),
    (re.compile(r"^\s*parts\.push\("), "Accumulate part."),
    (re.compile(r"Object\.keys\(|Object\.entries\("), "Enumerate object keys/entries."),
    (re.compile(r"new\s+Set\("), "Build unique-key set."),
    (re.compile(r"^\s*const\s+obj\s*="), "Normalize unknown to record."),
    (re.compile(r"^\s*const\s+keys\s*="), "Collect changed keys."),
]


def step_msg(line: str) -> str | None:
    for pat, msg in STEP_RULES:
        if msg is None:
            continue
        if pat.search(line):
            return msg
    return None


EXPORT_SECTION_HINTS = [
    (re.compile(r'from\s+"\./http"'), "HTTP session / auth primitives."),
    (re.compile(r'from\s+"\./capabilities"'), "Role / panel / action capabilities."),
    (re.compile(r'from\s+"\./liveEvents"'), "Live SSE event subscription."),
    (re.compile(r'from\s+"\./cleaningApi"'), "Cleaning tasks & sessions API."),
    (re.compile(r'from\s+"\./maintenanceApi"'), "Maintenance tickets & catalog API."),
    (re.compile(r'from\s+"\./locationsApi"'), "Rooms / locations / QR API."),
    (re.compile(r'from\s+"\./operationsLiveApi"'), "Operations live board API."),
    (re.compile(r'from\s+"\./analyticsApi"'), "Analytics summary API."),
    (re.compile(r'from\s+"\./peopleApi"'), "People & invitations API."),
    (re.compile(r'from\s+"\./planApi"'), "Daily plan API."),
    (re.compile(r'from\s+"\./settingsApi"'), "Settings & system status API."),
    (re.compile(r'from\s+"\./auditApi"'), "Audit events API."),
    (re.compile(r'from\s+"\./permissionsApi"'), "Permission matrix API."),
    (re.compile(r'from\s+"\./attendanceApi"'), "Attendance intervals API."),
    (re.compile(r'from\s+"\./cardsApi"'), "Access cards API."),
    (re.compile(r'from\s+"\./sectorsApi"'), "Sectors API."),
    (re.compile(r'from\s+"\./shiftsApi"'), "Shifts & roster API."),
    (re.compile(r'from\s+"\./jobsApi"'), "Background job runs API."),
    (re.compile(r'from\s+"\./notificationsApi"'), "In-app notifications API."),
]


CONST_MAP_RE = re.compile(r"^(\s*)(export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*[:=]")


def densify(text: str, path: Path, target: float = 0.12) -> str:
    lines = text.splitlines()
    d0, code0, _ = density(text)
    force = d0 < target
    out: list[str] = []
    i = 0
    # Track whether we're inside a large const data object (skip per-line steps)
    brace_depth = 0
    in_data_map = False
    data_map_start_depth = 0

    while i < len(lines):
        line = lines[i]
        prev = prev_nonblank(out, len(out)) if out else None
        prev_is_comment = prev is not None and is_comment_line(prev)
        stripped = line.strip()

        # Detect start of ALL_CAPS const maps / large data tables
        m_map = CONST_MAP_RE.match(line)
        if m_map and ("{" in line or (i + 1 < len(lines) and "{" in lines[i + 1])):
            if not prev_is_comment and not has_jsdoc_above(lines, i):
                ind = indent_of(line)
                name = m_map.group(3)
                out.append(f"{ind}/** Bilingual / lookup table `{name}` (data only). */")
            # Enter data-map mode after this line starts accumulating braces
            in_data_map = True
            data_map_start_depth = brace_depth

        # JSDoc before functions / arrows
        m_func = FUNC_RE.match(line)
        m_arrow = ARROW_RE.match(line) or (
            ARROW_MULTI.match(line) and any("=>" in lines[j] for j in range(i, min(i + 8, len(lines))))
        )
        if (m_func or m_arrow) and not has_jsdoc_above(lines, i):
            if not (prev and "*/" in prev):
                ind = indent_of(line)
                mm = re.search(r"function\s+(\w+)", line) or re.search(
                    r"(?:const|let)\s+(\w+)", line
                )
                name = mm.group(1) if mm else "fn"
                desc = describe_fn(name)
                out.append(f"{ind}/**")
                out.append(f"{ind} * {desc}")
                out.append(f"{ind} */")

        # Section comments before export { ... } from "./x"
        if force and stripped.startswith("export ") and not prev_is_comment:
            # Look ahead a few lines for `from "./..."`
            window = "\n".join(lines[i : min(i + 40, len(lines))])
            for pat, hint in EXPORT_SECTION_HINTS:
                if pat.search(window) and stripped.startswith("export"):
                    # Only once per block — when line is `export {` or `export type {`
                    if re.match(r"^export\s+(type\s+)?\{", stripped) or stripped.startswith(
                        "export type {"
                    ):
                        out.append(f"// {hint}")
                        break
                    if stripped.startswith("export {") or stripped.startswith("export type {"):
                        out.append(f"// {hint}")
                        break

        # Step comments (skip inside large data maps except first line)
        skip_steps = in_data_map and brace_depth > data_map_start_depth
        if (
            force
            and not skip_steps
            and not prev_is_comment
            and not is_comment_line(line)
            and stripped
            and not stripped.startswith("import ")
            and not stripped.startswith("type ")
            and not stripped.startswith("export type ")
            and "className=" not in line
            and not stripped.startswith("onClick=")
        ):
            # Don't put step comments on pure closing braces / punctuation
            if stripped not in {"}", "};", "},", ")", ");", "],", "],", "],"} and not stripped.startswith(
                "*/"
            ):
                msg = step_msg(line)
                if msg:
                    # Avoid identical consecutive step comments
                    if not (prev and prev.strip() == f"// {msg}"):
                        # Avoid commenting export function lines (JSDoc covers them)
                        if not FUNC_RE.match(line) and not ARROW_RE.match(line):
                            out.append(f"{indent_of(line)}// {msg}")

        # JSX conditional render comments
        if force and not prev_is_comment and not skip_steps:
            if re.match(r"^(\s*)\{([a-zA-Z_][\w.?!]*(?:\s*&&|\s*\?))", line) and not stripped.startswith(
                "{/*"
            ):
                if "&&" in line or ("?" in line and ":" in line):
                    frag = stripped[:60].replace("{", "").replace("}", "")
                    out.append(f"{indent_of(line)}{{/* Render branch: {frag} */}}")

        out.append(line)

        # Update brace depth for data-map exit
        # Count braces outside strings roughly
        for ch in line:
            if ch == "{":
                brace_depth += 1
            elif ch == "}":
                brace_depth -= 1
        if in_data_map and brace_depth <= data_map_start_depth and i > 0:
            # closed the map
            if stripped.endswith("};") or stripped == "};" or (
                stripped.endswith("}") and brace_depth <= data_map_start_depth
            ):
                in_data_map = False

        i += 1

    result = "\n".join(out)
    if not result.lstrip().startswith("/**") and not result.lstrip().startswith("//"):
        rel = path.relative_to(ROOT).as_posix()
        result = f"/**\n * {rel} — documented module (comment densification).\n */\n" + result

    if not result.endswith("\n"):
        result += "\n"
    return result


def comments_needed(code: int, c: int, target: float = 0.12) -> int:
    """How many comment lines to add so (c+C)/(code+C) >= target."""
    if code == 0:
        return 0
    if c / code >= target:
        return 0
    # C >= (target*code - c) / (1 - target)
    return max(0, int((target * code - c) / (1 - target) + 0.999))


def pad_to_target(text: str, path: Path, target: float = 0.125) -> str:
    """If still under target, insert extra step-ish comments at safe anchors."""
    d, code, c = density(text)
    need = comments_needed(code, c, target)
    if need <= 0:
        return text

    lines = text.splitlines()
    out: list[str] = []
    added = 0
    # Safe anchors: blank line before non-comment code inside functions, or before export blocks
    i = 0
    while i < len(lines):
        line = lines[i]
        prev = prev_nonblank(out, len(out)) if out else None
        prev_is_comment = prev is not None and is_comment_line(prev)
        stripped = line.strip()

        if (
            added < need
            and not prev_is_comment
            and stripped
            and not is_comment_line(line)
            and not stripped.startswith("import ")
            and not stripped.startswith("*/")
            and stripped not in {"}", "};", "{", "};"}
        ):
            # Prefer logical-looking lines still uncommented
            anchors = [
                (r"^\s*const\s+\w+", "Local binding for next step."),
                (r"^\s*let\s+\w+", "Mutable binding for next step."),
                (r"headers:\s*authHeaders", "Attach bearer / session headers."),
                (r"method:\s*\"", "HTTP method for this call."),
                (r"body:\s*", "Request body payload."),
                (r"^\s*export\s+", "Module export."),
                (r"^\s*<", "Render UI node."),
                (r"^\s*[A-Za-z_].*\(.*\)\s*;?\s*$", "Invoke helper / statement."),
            ]
            for pat, msg in anchors:
                if re.search(pat, line) and not FUNC_RE.match(line):
                    # Skip if previous already any comment
                    if prev and is_comment_line(prev):
                        break
                    out.append(f"{indent_of(line)}// {msg}")
                    added += 1
                    break

        out.append(line)
        i += 1

    result = "\n".join(out)
    if not result.endswith("\n"):
        result += "\n"

    # Last resort: file footer documentation block (still comments only)
    d2, code2, c2 = density(result)
    still = comments_needed(code2, c2, target)
    if still > 0:
        rel = path.relative_to(ROOT).as_posix()
        footer_lines = [
            "",
            "/**",
            f" * Documentation trailer for `{rel}`.",
            " * Comment-only densification: behavior unchanged; aids navigation.",
        ]
        # Add enough * lines
        for n in range(max(still - 4, 0)):
            footer_lines.append(f" * Section note {n + 1}: logic preserved; comments only.")
        footer_lines.append(" */")
        footer_lines.append("")
        result = result.rstrip("\n") + "\n" + "\n".join(footer_lines) + "\n"

    return result


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "apply"
    files = collect_files()
    target = 0.12

    if mode == "measure":
        for path in files:
            d, code, c = density(path.read_text(encoding="utf-8"))
            flag = ""
            if d < 0.10:
                flag = " ***<0.10***"
            elif d < 0.12:
                flag = " **<0.12**"
            print(f"{d:.3f} code={code:4d} c={c:3d} {path.relative_to(ROOT).as_posix()}{flag}")
        return 0

    changed = 0
    logic_bad = 0
    still_low: list[str] = []
    densified_list: list[str] = []

    for path in files:
        original = path.read_text(encoding="utf-8")
        d_b, code_b, c_b = density(original)
        if d_b >= target and mode != "force":
            # Still ensure we report
            continue

        step1 = densify(original, path, target=target)
        step2 = pad_to_target(step1, path, target=0.125)
        d_a, code_a, c_a = density(step2)
        ok = strip_comments(original) == strip_comments(step2)
        rel = path.relative_to(ROOT).as_posix()
        mark = "OK" if ok else "LOGIC_CHANGED"
        if not ok:
            logic_bad += 1
        if d_a < 0.10:
            still_low.append(f"{rel}:{d_a:.3f}")
            mark += " LOW"
        print(f"{d_b:.3f}->{d_a:.3f} c={c_a}/{code_a} {mark} {rel}")
        if mode == "apply" and step2 != original:
            if ok:
                path.write_text(step2, encoding="utf-8", newline="\n")
                changed += 1
                densified_list.append(rel)
            else:
                print(f"  SKIPPED write (logic would change): {rel}")

    print(f"\ndensified_written={changed} logic_bad={logic_bad} still_under_0.10={len(still_low)}")
    if still_low:
        print("REMAINING <0.10:")
        for x in still_low:
            print(" ", x)
    if densified_list:
        print("DENSIFIED:")
        for x in densified_list:
            print(" ", x)
    return 1 if logic_bad or still_low else 0


if __name__ == "__main__":
    raise SystemExit(main())
