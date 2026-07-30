# Edge-overlay performance — remaining open items

> **Status: Phases 0–3 SHIPPED (2026-07-22).** Full write-up + benchmarks archived at
> [archive/edge-overlay-performance.md](./archive/edge-overlay-performance.md). This file is the
> open residue only.
>
> **The move this plan used to wait on has landed** (2026-07-30,
> [visualization-package](./archive/visualization-package.md)) — the old "land nothing here before
> that move" gate no longer applies. The files are now in `@selvajs/visualization`:
> `render/edges/*` (extraction, cache, overlay, options), `render/scene-setup/*`, and the screen-space
> pass in `render/`. Target those paths, not the old `packages/compute` ones.
>
> **Note for item 1:** the edge cache has changed since this plan was written — `clearScene` now
> releases edge-cache entries (a live GPU leak, caching-audit §F1, fixed 2026-07-30). A GPU verify
> run should confirm the crease look **and** that entry counts plateau across solves.

## Open

1. **GPU-visual verification** — run the screen-space edge pass in a real browser (`pnpm example`)
   and confirm the crease look at high triangle counts. Everything else is unit/bench-covered; this
   is the one thing static tests can't check. No code change expected — verification only.
2. **Phase 4 (optional, separate track) — Rhino-authored edges.** Ship true BREP/mesh crease edges
   from the plugin as an optional per-mesh channel instead of deriving them client-side. Large,
   spans plugin + wire format + client; only worth it if client-side extraction proves insufficient
   for definitions with thousands of BREP edges. Details in the archived plan's "Phase 4" section.
