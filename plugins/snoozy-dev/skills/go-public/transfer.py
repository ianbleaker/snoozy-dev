"""Move numbers start..max from OLD to NEW in order so every issue/PR number is kept (/go-public step 7).

Issue → `gh issue transfer`. PR → closed stand-in issue "PR #n: <title>" with
the PR's description. Missing number → placeholder created then deleted.
Stops at the first error or number mismatch.

A GitHub 5xx can hide a create that actually succeeded: after a stop, check
`gh issue view <n> --repo NEW` first; if it exists, finish that number by hand
(close a stand-in, delete a placeholder) and resume at n+1.

Usage: python3 -I transfer.py <OLD owner/repo> <NEW owner/repo> <workdir> [start]
  <workdir> caches the PR/issue lists (prs.json, issues.json) so a resume
  works from the same snapshot even though transfers empty OLD's issue list.
"""
import json
import os
import re
import subprocess
import sys


def gh(*a):
    r = subprocess.run(["gh", *a], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"STOP: gh {' '.join(a[:3])} failed: {r.stderr.strip()}")
    return r.stdout.strip()


def number(url):
    m = re.search(r"/issues/(\d+)\s*$", url)
    return int(m.group(1)) if m else None


def snapshot(old, work, kind, fields):
    path = f"{work}/{kind}s.json"
    if not os.path.exists(path):
        os.makedirs(work, exist_ok=True)
        open(path, "w").write(gh(kind, "list", "--repo", old, "--state", "all", "--limit", "1000", "--json", fields))
    return json.load(open(path))


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    old, new, work = sys.argv[1:4]
    start = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    prs = {p["number"]: p for p in snapshot(old, work, "pr", "number,title,body,state,mergedAt,closedAt")}
    issues = {i["number"] for i in snapshot(old, work, "issue", "number,state")}
    top = max(set(prs) | issues)
    for n in range(start, top + 1):
        if n in issues:
            got, kind = number(gh("issue", "transfer", str(n), new, "--repo", old)), "issue"
        elif n in prs:
            p = prs[n]
            state = "merged" if p["mergedAt"] else p["state"].lower()
            body = f"Pull request from before the move, {state} {(p['mergedAt'] or p['closedAt'] or '')[:10]}."
            if (p["body"] or "").strip():
                body += "\n\n" + p["body"]
            path = f"{work}/pr-body-{n}.md"
            open(path, "w").write(body)
            got = number(gh("issue", "create", "--repo", new, "--title", f"PR #{n}: {p['title']}", "--body-file", path))
            if got == n:
                gh("issue", "close", str(n), "--repo", new, "--reason", "completed" if p["mergedAt"] else "not planned")
            kind = "PR stand-in"
        else:
            got = number(gh("issue", "create", "--repo", new, "--title", "placeholder", "--body", "placeholder"))
            if got == n:
                gh("issue", "delete", str(n), "--repo", new, "--yes")
            kind = "placeholder"
        print(f"{n}: {kind} -> #{got}", flush=True)
        if got != n:
            sys.exit(f"STOP: number mismatch at {n} (got {got})")
    print(f"DONE {start}..{top}")


if __name__ == "__main__":
    main()
