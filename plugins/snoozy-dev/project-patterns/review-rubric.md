# Review rubric pattern

Cached judgment. A planner-tier session distills *this codebase's* specific
failure modes into `docs/review-rubric.md`; reviewers at any tier — `/audit-plan`,
`/code-review`, a human — apply it mechanically. It's how a Haiku-tier review
inherits planner-tier pattern recognition.

## Rules

- **Every entry earns its place with a real incident** — a bug that shipped, a
  review finding, a near-miss. No hypothetical hygiene items: generic advice is
  what the models already know, and it dilutes the entries that matter.
- One line per entry: *trigger → check → why (the incident)*.
- Keep the whole file under ~30 lines. Prune entries whose class of bug hasn't
  recurred — a rubric that only grows stops being read.
- Maintenance is planner-tier work: `/audit-plan` proposes new entries when it
  catches a repeated class of bug; `/wrap-up` is a natural pruning point.

## Template (`docs/review-rubric.md` in the project)

```markdown
# Review rubric

## <Area>
- When touching <X>, verify <Y> — <incident: what went wrong once>
```

## Example entries (illustrative)

```markdown
## Events
- When adding an EventType, verify fold.ts projects it — several declared types
  were silently dropped for months before plan 30 wired them.
- When events carry subject/target ids, verify the visibility filter actually
  receives them — the player-visibility logic was dead code until plan 30.
```
