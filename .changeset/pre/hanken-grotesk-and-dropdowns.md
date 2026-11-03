---
'@selvajs/ui': minor
'@selvajs/selva': patch
---

One typeface, one content width, one dropdown.

- **Hanken Grotesk is the UI typeface.** `base.css` loads it from `@fontsource-variable/hanken-grotesk` and sets `--font-sans`, so every app importing it (including the plugin UI embedded in the `.gha`) gets it self-hosted, no network fetch.
- **`PageContent` is the shared page frame:** centred, `max-w-6xl`, page padding. It now renders a `<div>` instead of a `<main>`, because `AppShell` already provides the `<main>`. A consumer relying on full width can override it with `class`.
- **`FilterableDropdown` gains `name`** (hidden input for a plain form post), **`size`** (`'default' | 'sm'`), **`aria-label`** and a per-item **`disabled`**.
- **Selva:** settings, team, Library and Projects share one content width. The Projects page is a single scrolling column titled with the selected project, and new projects are created in a dialog. Every native `<select>` is now a `FilterableDropdown`, and lint rejects new ones. The landing page wires are easier to see and its hero is tighter.
