# Architecture docs + component-reuse convention (UI/component-based projects)

Prevents two failure modes as a codebase grows: Claude re-reading source to
rebuild a mental model every session, and duplicate components proliferating
because nothing records what already exists.

## Structure (per project)

```
docs/architecture/
  overview.md       # entry point — file tree, key invariants, doc-sync table
  components.md     # component tree: props, where it renders, what it replaces
  <topic>.md         # one doc per architectural area (data model, permissions, ...)
```

Living documents: written in present tense, updated alongside the code change
that motivated the edit — not batched as an afterthought.

## CLAUDE.md sections to scaffold

```markdown
## Component conventions

- **Reuse first.** Before writing a new component or repeating a JSX pattern,
  search the components directory for an existing implementation that fits or
  can be extended.
- **Abstract at second use.** If the same UI pattern appears in two or more
  places, extract it to a shared component and add it to
  `docs/architecture/components.md`.
- **Document new components.** Any new shared component must be added to the
  component tree in `docs/architecture/components.md` before the work is
  considered complete — include its props, where it renders, and what it replaces.
- **No inline duplication.** Duplicated JSX blocks (even slightly varied) are a
  signal to abstract, not a shortcut.

## Architecture docs

Living documents in `docs/architecture/` — written in present tense, updated
alongside code changes. `docs/architecture/overview.md` is the entry point: it
holds the file tree, key invariants, and the doc-sync table (edited file →
which doc to update). Consult it to find the right doc for any area.
```

## Why this pairs with implement-plan / audit-plan

- `implement-plan` step 6 ("sync living docs") depends on the doc-sync table
  existing and being current — it updates the mapped doc as part of the item
  that touched the code, not as an afterthought.
- `audit-plan` step 4 explicitly hunts for "doc-sync skipped" as an executor
  failure mode — it can only catch that if the table exists and names the
  right doc per area.

## When to offer this

Only for UI/component-based projects (a components directory exists — React,
Vue, Svelte, etc.). Skip for CLI tools, libraries, and backend-only services —
`overview.md` and the doc-sync table can still apply there, but drop the
Component conventions section.
