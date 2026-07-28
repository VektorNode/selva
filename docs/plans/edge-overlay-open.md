# Edge-overlay performance — remaining open items

> **Status: Phases 0–3 SHIPPED (2026-07-22).** Full write-up + benchmarks archived at
> [archive/edge-overlay-performance.md](./archive/edge-overlay-performance.md). This file is the
> open residue only. Scope: `packages/compute` visualization (`edges.ts`, `edge-extract.ts`,
> `edge-detection-pass.ts`, `render-pipeline.ts`, `three-initializer.ts`) — **these files move to
> `@selvajs/visualization` in [the visualization-package plan](./visualization-package.md), so land nothing here before
> that move (or rebase across it).**

## Open

1. **GPU-visual verification** — run the screen-space edge pass in a real browser (`pnpm example`)
   and confirm the crease look at high triangle counts. Everything else is unit/bench-covered; this
   is the one thing static tests can't check. No code change expected — verification only.
2. **Phase 4 (optional, separate track) — Rhino-authored edges.** Ship true BREP/mesh crease edges
   from the plugin as an optional per-mesh channel instead of deriving them client-side. Large,
   spans plugin + wire format + client; only worth it if client-side extraction proves insufficient
   for definitions with thousands of BREP edges. Details in the archived plan's "Phase 4" section.
