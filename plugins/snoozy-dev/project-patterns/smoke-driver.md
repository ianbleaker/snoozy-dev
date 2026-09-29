# Smoke-test scenario library (UI apps)

The most expensive Claude Code habit observed in practice: driving a browser
interactively — one `click`/`fill`/`wait` per model turn. A single debugging
session this way can burn more tokens than a week of normal work (measured:
159 Bash round-trips in one session).

**The rule: scenarios, not sessions.** All browser driving goes through named,
batched scripts. A smoke test is 1–2 Bash calls: run the scenario, read the result.

## Structure (per project)

```
.claude/skills/smoke-test/
  SKILL.md          # driver usage + scenario index + selector gotchas
  driver.mjs        # headless Playwright REPL: reads commands from stdin,
                    # prints OK/ERR per line (see reference implementation)
  scenarios/
    create-journal.txt
    open-entry.txt
    relay-pair.txt
```

A scenario file is a plain list of driver commands, ending with `errors` (and
optionally `screenshot <name>`):

```
nav http://localhost:5173
fill ".journal-list-create .input" Smoke Test Journal
click ".journal-list-create .btn--primary"
wait-text Smoke Test Journal
screenshot journal-open
errors
quit
```

Run: `node .claude/skills/smoke-test/driver.mjs < scenarios/create-journal.txt`

**Commit it.** The skill is app-specific (selectors, flows), so it lives in
the project repo, not here. Claude Code only discovers project skills under
`.claude/skills/`, so if the project ignores `.claude/`, un-ignore just that
folder (the directory pattern must become `.claude/*`, or git can't negate
inside it) and keep run output ignored:

```gitignore
.claude/*
!.claude/skills/
.claude/skills/**/screenshots/
```

## Rules for the skill's SKILL.md

1. **Never drive interactively.** To test something new, write or extend a scenario file, run it once, read the full transcript of OK/ERR lines. Iterate on the file, not one command at a time.
2. **Accumulate scenarios.** Every flow debugged once becomes a named scenario — the next session replays it for free.
3. **Record selector gotchas** in the skill doc as they're discovered (quoting rules, disabled-until-filled buttons, ellipsis characters in placeholders), so no session rediscovers them.
4. **Offer a preview check.** Give one scenario that covers the app's core flow and takes the base URL as an argument. Name it on `## Deploy`'s `Preview check:` line (see `deploy-scripts.md`). `/stage-preview` then runs it automatically against every fresh preview deploy.
5. **Respect the testing policy**: routine styling/layout changes get no browser testing at all — the user smoke tests manually. Scenarios are for genuinely complex interaction flows.

## Reference implementation

`plugins/snoozy-dev/project-patterns/smoke-driver.mjs` (in the snoozy-dev repo) — a Playwright stdin REPL
supporting `nav`, `click`, `fill`, `type`, `press`, `wait`, `wait-text`,
`eval`, `screenshot`, `errors`, `title`, `url`, `quit`. Copy into the
project's `.claude/skills/smoke-test/driver.mjs` and adapt selectors per app;
the driver itself is app-agnostic.
