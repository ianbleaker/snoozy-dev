"""Scan a repo for traces of Claude: history on every ref (including refs/pull/*), PRs and issues.

Used by /go-public steps 2, 5 and 9 (see SKILL.md next to this file). Uses the
broad pattern from global/hooks/claude-free.py. Clones into <workdir>, which is
replaced; the temporary refs/audit/* refs live only in that clone.

Usage: python3 -I audit.py <owner/repo | /path/to/local/repo> <workdir> [--no-gh]
  --no-gh  history only (for a local rewritten clone with no GitHub repo yet)
"""
import json
import re
import shutil
import subprocess
import sys
from collections import defaultdict

PAT = re.compile(r"\b(claude|anthropic)\b|co-authored-by|claude\.(ai|com)/", re.I)
# The user's own README credit line ("assisted by ... Claude by Anthropic") is allowed.
CREDIT = re.compile(r"\bassisted by\b", re.I)


def run(*a, cwd=None, inp=None):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True, input=inp, check=True).stdout


def snip(t, m):
    return t[max(0, m.start() - 40):m.end() + 40].replace("\n", " ")


def scan_history(src, work):
    shutil.rmtree(work, ignore_errors=True)
    g = f"{work}/r.git"
    run("git", "clone", "-q", "--bare", src, g)
    subprocess.run(["git", "fetch", "-q", "origin", "+refs/pull/*/head:refs/audit/pull/*"], cwd=g)
    print("refs/pull heads:", len(run("git", "for-each-ref", "refs/audit", cwd=g).splitlines()))

    print("== COMMITS (messages, authors) across all refs")
    n = 0
    for rec in run("git", "log", "--all", "--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x01", cwd=g).split("\x01"):
        parts = rec.strip("\n").split("\x00")
        if len(parts) < 4:
            continue
        n += 1
        h, au, co, msg = parts
        for field, t in (("author", au), ("committer", co), ("message", msg)):
            for m in PAT.finditer(t):
                print(f"  {h[:10]} {field}: …{snip(t, m)}…")
    print(f"  ({n} commits scanned)")

    print("== BLOBS across all refs (path: distinct hits in any version)")
    paths = {}
    for line in run("git", "rev-list", "--all", "--objects", cwd=g).splitlines():
        sha, _, path = line.partition(" ")
        if path:
            paths.setdefault(sha, set()).add(path)
    types = run("git", "cat-file", "--batch-check=%(objectname) %(objecttype)", cwd=g, inp="\n".join(paths) + "\n")
    hits = defaultdict(set)
    for sha in (l.split()[0] for l in types.splitlines() if l.endswith(" blob")):
        data = subprocess.run(["git", "cat-file", "blob", sha], cwd=g, capture_output=True).stdout
        if b"\0" in data[:8000]:
            continue
        text = data.decode("utf-8", "replace")
        for m in PAT.finditer(text):
            end = text.find("\n", m.end())
            line = text[text.rfind("\n", 0, m.start()) + 1:end if end >= 0 else None]
            for p in paths[sha]:
                if p.rsplit("/", 1)[-1] == "README.md" and CREDIT.search(line):
                    continue
                hits[p].add(snip(text, m).strip())
    for p in sorted(hits):
        print(f"  {p}  ({len(hits[p])} distinct)")
        for s in sorted(hits[p])[:3]:
            print(f"      …{s}…")
    subprocess.run(["git", "update-ref", "--stdin"], cwd=g, text=True,
                   input=run("git", "for-each-ref", "--format=delete %(refname)", "refs/audit", cwd=g))


def scan_items(repo, kind):
    items = json.loads(run("gh", kind, "list", "--repo", repo, "--state", "all", "--limit", "1000",
                           "--json", "number,title,body,comments"))
    for it in items:
        fields = [("title", it["title"]), ("body", it["body"] or "")]
        fields += [(f"comment {c['url'].rsplit('-', 1)[-1]}", c["body"]) for c in it["comments"]]
        for where, t in fields:
            for m in PAT.finditer(t):
                print(f"  {kind} #{it['number']} {where}: …{snip(t, m)}…")
    return items


def main():
    repo, work = sys.argv[1], sys.argv[2]
    local = repo.startswith("/")
    scan_history(repo if local else f"https://github.com/{repo}.git", work)
    if local or "--no-gh" in sys.argv:
        return
    print("== PRs")
    prs = scan_items(repo, "pr")
    for c in json.loads(run("gh", "api", "--paginate", f"repos/{repo}/pulls/comments") or "[]"):
        for m in PAT.finditer(c["body"]):
            print(f"  review comment {c['id']} (PR {c['pull_request_url'].rsplit('/', 1)[-1]}): …{snip(c['body'], m)}…")
    print("== ISSUES")
    issues = scan_items(repo, "issue")
    nums = [i["number"] for i in prs + issues]
    top = max(nums, default=0)
    print(f"== counts: PRs {len(prs)}, issues {len(issues)}, max number {top}, "
          f"missing numbers {sorted(set(range(1, top + 1)) - set(nums))}")


if __name__ == "__main__":
    main()
