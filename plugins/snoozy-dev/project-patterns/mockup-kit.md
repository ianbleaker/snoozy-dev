# Mockup kit (UI apps)

Brainstorm's Visual Companion draws mockups with generic inline CSS, so they don't look like the app being designed. A **mockup kit** fixes that. It is a small per-project script that wraps a mockup HTML fragment in one self-contained page, styled with the project's own design tokens and stylesheets. The kit only builds the page. Brainstorm still shows it the usual way: as an Artifact when the Artifact tool is available, otherwise as a local HTML file.

## Structure (per project)

```
<kit>/
  render.mjs   # copy of the reference script (no dependencies)
  kit.json     # which stylesheets/fonts to inline (paths relative to project root)
  SKILL.md     # usage, component snippets, gotchas
```

`<kit>` lives in one of two places:

- **Companion**: `.claude/skills/mockup-kit/`. Use it when the project has a private companion repo (a `Private repo:` line in `CLAUDE.md`), because `.claude/` is symlinked into the companion and the kit lands there. This is the default in that case. Without a companion, this location sits in the project's own `.claude/`.
- **Project**: a tracked `mockup-kit/` folder at the project root. Use it when the kit should ship with the project's code, for example so collaborators can use it.

The file is named `SKILL.md` in both locations. Brainstorm always reads `<kit>/SKILL.md`, and under `.claude/skills/` Claude Code also discovers it as a project skill.

## The pointer

Brainstorm never assumes a folder. It finds the kit through this exact line under `## Pointers` in the project's `CLAUDE.md`:

```
- Mockup kit: <path>
```

`<path>` is relative to the project root and ends in `/`, e.g. `- Mockup kit: .claude/skills/mockup-kit/` or `- Mockup kit: mockup-kit/`. Brainstorm looks it up with `grep -m1 '^- Mockup kit: ' CLAUDE.md`. If the line is missing, there's no kit.

## kit.json

```json
{
  "css": ["src/styles/tokens.css", "src/styles/app.css"],
  "fonts": ["https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap"],
  "bodyClass": "app",
  "htmlAttrs": { "data-theme": "light" }
}
```

- `css` (required, non-empty): stylesheets inlined in order. Relative `@import`s are inlined recursively, and relative `url()` assets (fonts, images up to 2 MB) become `data:` URIs. Inlining matters because Artifact pages may load external stylesheets only from Google Fonts.
- `fonts`: Google Fonts stylesheet URLs, emitted as `<link>`s.
- `bodyClass`: class on `<body>`, for apps that scope styles to a root class.
- `htmlAttrs`: attributes on `<html>`, e.g. `data-theme` to pick a theme.

Every path is relative to the **project root**, and `render.mjs` always runs from the project root, so the kit works whichever repo holds it.

## Stack notes

- **Plain CSS / custom properties**: list the source files directly, tokens first.
- **Tailwind, Sass, CSS modules**: list the **compiled** CSS output, and build the app's CSS before rendering. The kit has no build step. Tailwind's JIT only emits classes it found in scanned sources, so mockups should stick to classes the app already uses, which means the snippet catalog in the kit's `SKILL.md`.

## Template for the kit's SKILL.md

````markdown
---
name: mockup-kit
description: Render brainstorm mockups with this app's own tokens and stylesheets.
---

# Mockup kit

## Usage
From the project root:

```
node <kit>/render.mjs <fragment.html> --out <file.html> [--title <text>]
```

Write only the body fragment. Lay options out with `.mk-options` > `.mk-option`, each starting with a `.mk-label` (A/B/C). The app's tokens govern colors and theming, so don't add inline colors.

## Component snippets
Canonical markup with real class names. Reuse these instead of inventing markup.

### Button
```html
<button class="btn btn--primary">Save</button>
```

### Card
```html
<div class="card"><h3 class="card__title">Title</h3><p>Body</p></div>
```

## Gotchas
- (Add these as you find them: a required root class, theme attributes, classes missing from compiled CSS.)
````

## Rules

1. **Snippets over invention.** Every mockup reuses the catalog. When a mockup needs markup the catalog lacks, take it from the app's real components and add it to the catalog.
2. **Accumulate gotchas** in the kit's `SKILL.md` as you find them, so no session rediscovers them.
3. **Gitignore.** Under `.claude/skills/` in a project without a companion, if the project ignores `.claude/`, un-ignore just that folder (the directory pattern must become `.claude/*`, or git can't negate inside it), as in `smoke-driver.md`:

   ```gitignore
   .claude/*
   !.claude/skills/
   ```

   Rendered pages go to the session scratchpad and are never committed.

## Reference implementation

`plugins/snoozy-dev/project-patterns/mockup-kit.mjs` (in the snoozy-dev repo) is a dependency-free Node script. It reads `kit.json`, inlines the CSS, adds the `mk-` helper classes and wraps the fragment. Copy it into the project as `<kit>/render.mjs`. The script is app-agnostic; all per-app configuration lives in `kit.json` and the kit's `SKILL.md`.
