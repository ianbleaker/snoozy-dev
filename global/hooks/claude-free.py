"""Block commits, pushes, issues and PRs that mention Claude (the Claude-free rule).

Claude Code PreToolUse hook: JSON on stdin, exit 2 with a stderr message to
block. The rule lives in global/CLAUDE.md. A repo is exempt when a file named
.claude-free-exempt sits at its top level (snoozy-dev and companion repos).

Checked:
  git commit   -m/--message values and the -F/--file file (broad pattern),
               added lines in the staged diff (narrow pattern)
  git push     messages and added lines of the commits being pushed
  gh issue|pr create|edit|comment|review|close
               --title/-t, --body/-b and the --body-file/-F file (broad)
  gh api       -f/-F/--field/--raw-field values keyed title, body or message
  mcp__github__*  title/body/message (broad) and content (narrow) values

Run as: python3 -I claude-free.py
"""
import json
import os
import re
import shlex
import subprocess
import sys

BROAD = re.compile(r"\b(claude|anthropic)\b|co-authored-by|claude\.(ai|com)/", re.I)
NARROW = re.compile(
    r"claude\.(ai|com)/|\bCLAUDE\.md\b|(^|[\s/\"'(])\.claude/"
    r"|co-authored-by:.*(claude|anthropic)|generated with \[?claude",
    re.I,
)
SEPARATORS = {"&&", "||", ";", ";;", "|", "|&", "&", "(", ")", "\n"}
HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")
GH_ACTIONS = {"create", "edit", "comment", "review", "close"}
API_KEYS = {"title", "body", "message"}


def git(cwd, *args):
    if cwd is None:
        return None
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def exempt(cwd):
    """True outside a git repo, or when the repo carries .claude-free-exempt.

    cwd is None when a `cd`/`-C` target couldn't be resolved (an unknown
    variable, say): never exempt then, so text is still checked.
    """
    if cwd is None:
        return False
    if not os.path.isdir(cwd):
        return True
    top = git(cwd, "rev-parse", "--show-toplevel")
    return top is None or os.path.exists(os.path.join(top.strip(), ".claude-free-exempt"))


def extract_heredocs(cmd):
    """Replace each heredoc (marker, body, terminator) with a placeholder token."""
    bodies = []
    while True:
        m = HEREDOC.search(cmd)
        if not m:
            return cmd, bodies
        nl = cmd.find("\n", m.end())
        if nl == -1:
            return cmd, bodies
        lines = cmd[nl + 1:].split("\n")
        for i, line in enumerate(lines):
            if line.strip() == m.group(2):
                break
        else:
            i = len(lines)
        body = "\n".join(lines[:i])
        rest = "\n".join(lines[i + 1:])
        token = f"__HEREDOC_{len(bodies)}__"
        bodies.append(body)
        cmd = cmd[:m.start()] + token + cmd[m.end():nl] + ("\n" + rest if rest else "")


def tokenize(cmd):
    lx = shlex.shlex(cmd, posix=True, punctuation_chars="();<>|&\n")
    lx.whitespace = " \t\r"
    lx.whitespace_split = True
    return list(lx)


def segments(tokens):
    seg = []
    for t in tokens:
        if t in SEPARATORS:
            if seg:
                yield seg
            seg = []
        else:
            seg.append(t)
    if seg:
        yield seg


def resolve(cwd, path, env):
    """Join a cd/-C target onto cwd, expanding ~ and variables; None if unresolved."""
    path = re.sub(r"\$(\w+)|\$\{(\w+)\}", lambda m: env.get(m.group(1) or m.group(2), m.group(0)), path)
    path = os.path.expandvars(os.path.expanduser(path))
    if cwd is None or "$" in path:
        return None if not os.path.isabs(path) or "$" in path else os.path.normpath(path)
    return os.path.normpath(os.path.join(cwd, path))


def read_file(cwd, path, bodies):
    if path == "-":
        return "\n".join(bodies)
    if cwd is None:
        return ""
    try:
        with open(os.path.join(cwd, os.path.expanduser(path)), encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def added_lines(diff):
    return "\n".join(l[1:] for l in (diff or "").splitlines() if l.startswith("+") and not l.startswith("+++"))


def flag_values(args, short, long_):
    """Values of a flag given as `-x v`, `-xv`, `--long v`, `--long=v`, or a combined `-ax v`."""
    out = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in long_ and i + 1 < len(args):
            out.append(args[i + 1])
            i += 2
            continue
        if any(a.startswith(l + "=") for l in long_):
            out.append(a.split("=", 1)[1])
        elif short and a.startswith("-") and not a.startswith("--") and len(a) > 1:
            for j, c in enumerate(a[1:], 1):
                if c in short:
                    if j + 1 < len(a):
                        out.append(a[j + 1:])
                    elif i + 1 < len(args):
                        out.append(args[i + 1])
                        i += 1
                    break
        i += 1
    return out


def check_git(cwd, args, bodies, broad, narrow, env):
    sub, i = None, 0
    while i < len(args):
        a = args[i]
        if a == "-C" and i + 1 < len(args):
            cwd = resolve(cwd, args[i + 1], env)
            i += 2
        elif a in ("-c", "--git-dir", "--work-tree", "--namespace") and i + 1 < len(args):
            i += 2
        elif a.startswith("-"):
            i += 1
        else:
            sub = a
            break
    rest = args[i + 1:]
    if sub not in ("commit", "push") or exempt(cwd):
        return
    if sub == "commit":
        broad.extend(flag_values(rest, "m", ["--message"]))
        broad.extend(read_file(cwd, f, bodies) for f in flag_values(rest, "F", ["--file"]))
        all_ = "--all" in rest or any(a.startswith("-") and not a.startswith("--") and "a" in a[1:].split("m")[0] for a in rest)
        diff = git(cwd, "diff", "HEAD" if all_ else "--cached", "-U0")
        narrow.append(added_lines(diff))
    else:
        base = "@{u}" if git(cwd, "rev-parse", "--verify", "-q", "@{u}") else "origin/main"
        if git(cwd, "rev-parse", "--verify", "-q", base) is None:
            return
        broad.append(git(cwd, "log", "--format=%B", f"{base}..HEAD") or "")
        narrow.append(added_lines(git(cwd, "diff", f"{base}...HEAD")))


def check_gh(cwd, args, bodies, broad):
    words = [a for a in args if not a.startswith("-")][:2]
    if exempt(cwd):
        return
    if len(words) == 2 and words[0] in ("issue", "pr") and words[1] in GH_ACTIONS:
        broad.extend(flag_values(args, "tb", ["--title", "--body"]))
        broad.extend(read_file(cwd, f, bodies) for f in flag_values(args, "F", ["--body-file"]))
    elif words[:1] == ["api"]:
        for kv in flag_values(args, "fF", ["--field", "--raw-field"]):
            key, _, val = kv.partition("=")
            if key in API_KEYS:
                broad.append(read_file(cwd, val[1:], bodies) if val.startswith("@") else val)


def collect_bash(cmd, cwd):
    broad, narrow, env = [], [], {}
    stripped, bodies = extract_heredocs(cmd)
    for seg in segments(tokenize(stripped)):
        refs = [bodies[int(n)] for n in re.findall(r"__HEREDOC_(\d+)__", " ".join(seg))]
        seg = [re.sub(r"__HEREDOC_(\d+)__", lambda m: bodies[int(m.group(1))], t) for t in seg]
        assigns = []
        while seg and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", seg[0]):
            assigns.append(seg[0].split("=", 1))  # FOO=1 git commit ...
            seg = seg[1:]
        if not seg:
            env.update(assigns)  # bare `S=...;` sets a shell variable for later segments
            continue
        prog = os.path.basename(seg[0])
        if prog == "cd":
            cwd = resolve(cwd, seg[1] if len(seg) > 1 else "~", env)
        elif prog == "git":
            check_git(cwd, seg[1:], refs, broad, narrow, env)
        elif prog == "gh":
            check_gh(cwd, seg[1:], refs, broad)
    return broad, narrow


def collect_mcp(tool_input):
    broad, narrow = [], []

    def walk(v, key=None):
        if isinstance(v, dict):
            for k, x in v.items():
                walk(x, k)
        elif isinstance(v, list):
            for x in v:
                walk(x, key)
        elif isinstance(v, str):
            if key in API_KEYS:
                broad.append(v)
            elif key == "content":
                narrow.append(v)

    walk(tool_input)
    return broad, narrow


def hits(pattern, texts):
    out = []
    for text in texts:
        for m in pattern.finditer(text or ""):
            s = text[max(0, m.start() - 30):m.end() + 30].replace("\n", " ")
            out.append(s.strip())
    return out


def main():
    data = json.load(sys.stdin)
    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    cwd = data.get("cwd") or os.getcwd()
    if tool == "Bash":
        cmd = tool_input.get("command", "")
        try:
            broad, narrow = collect_bash(cmd, cwd)
        except ValueError:
            # Unparseable (e.g. unbalanced quotes): bash would reject it too, so
            # only block when it is clearly a publishing command that mentions Claude.
            if re.search(r"\bgit\s+commit\b|\bgh\s+(issue|pr|api)\b", cmd) and not exempt(cwd):
                broad, narrow = [cmd], []
            else:
                return 0
    elif tool.startswith("mcp__github__"):
        if exempt(cwd):
            return 0
        broad, narrow = collect_mcp(tool_input)
    else:
        return 0
    found = hits(BROAD, broad) + hits(NARROW, narrow)
    if not found:
        return 0
    print("Blocked by the Claude-free rule (global/CLAUDE.md): no mention of Claude or "
          "Anthropic, attribution footers, Co-Authored-By trailers, or session/artifact "
          "links in commits, PRs, issues, comments or tracked files. Claude links belong "
          "only in plan docs. Matched:", file=sys.stderr)
    for s in dict.fromkeys(found):
        print(f"  - …{s}…", file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never block on a hook bug; exit 1 shows the error without blocking
        print(f"claude-free hook error (allowed): {e!r}", file=sys.stderr)
        sys.exit(1)
