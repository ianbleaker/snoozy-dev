"""Join hard-wrapped Markdown prose so each paragraph / list item is one line.

Obsidian (and other renderers with strict line breaks off) shows every source
newline as a line break, so prose wrapped at ~100 columns renders ragged.
Fences, tables, headings, front matter, explicit hard breaks and list/quote
starts are left alone; only continuation lines are joined.

Usage: md-unwrap.py [--check] FILE...
       md-unwrap.py --hook        (Claude Code PostToolUse: JSON on stdin)
--check: print wrapped spots and exit 1 if any, change nothing.
"""
import json
import re
import sys

FENCE = re.compile(r"^\s*(```|~~~)")
LIST = re.compile(r"^\s*([-*+]|\d+[.)])\s+")
BLOCK_START = re.compile(r"^\s*(#|\||>|<|---\s*$|\*\*\*\s*$|___\s*$|\[[^\]]+\]:)")


def is_break(line):
    """Lines that never get joined onto the previous line."""
    return (
        not line.strip()
        or FENCE.match(line)
        or LIST.match(line)
        or BLOCK_START.match(line)
    )


def joinable_head(line):
    """Lines whose end may take a continuation."""
    s = line.strip()
    if not s or FENCE.match(line):
        return False
    if s.startswith(("#", "|", "<")) or re.match(r"^(---|\*\*\*|___)\s*$", s):
        return False
    if line.endswith("  ") or line.rstrip().endswith("\\"):
        return False  # explicit Markdown hard break
    return True


def unwrap(text):
    lines = text.split("\n")
    out, hits = [], []
    in_fence = False
    in_front = bool(lines) and lines[0].strip() == "---"
    for i, line in enumerate(lines):
        if in_front:
            out.append(line)
            if i > 0 and line.strip() == "---":
                in_front = False
            continue
        if FENCE.match(line):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue
        prev = out[-1] if out else ""
        quote = re.match(r"^\s*>\s?", line)
        if quote and prev.lstrip().startswith(">"):
            rest = line[quote.end():]
            if rest.strip() and not LIST.match(rest) and not rest.lstrip().startswith(("#", "|")) and joinable_head(prev.lstrip("> ")):
                out[-1] = prev.rstrip() + " " + rest.strip()
                hits.append(i + 1)
                continue
        if out and not is_break(line) and joinable_head(prev) and not prev.lstrip().startswith(">"):
            out[-1] = prev.rstrip() + " " + line.strip()
            hits.append(i + 1)
            continue
        out.append(line)
    return "\n".join(out), hits


def hook():
    try:
        path = (json.load(sys.stdin).get("tool_input") or {}).get("file_path") or ""
    except ValueError:
        return 0
    if not path.lower().endswith(".md"):
        return 0
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return 0
    new, hits = unwrap(text)
    if hits:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": f"md-unwrap: joined {len(hits)} hard-wrapped lines in {path} "
            "(one line per paragraph/list item). Re-read before editing it again, and write "
            "Markdown unwrapped from now on.",
        }}))
    return 0


def main(argv):
    if argv == ["--hook"]:
        return hook()
    check = "--check" in argv
    files = [a for a in argv if a != "--check"]
    found = False
    for path in files:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        new, hits = unwrap(text)
        if not hits:
            continue
        found = True
        if check:
            print(f"{path}: hard-wrapped lines at {', '.join(map(str, hits[:10]))}{' …' if len(hits) > 10 else ''}")
        else:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new)
            print(f"{path}: joined {len(hits)} wrapped lines")
    return 1 if (check and found) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
