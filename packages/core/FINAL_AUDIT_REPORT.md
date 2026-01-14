# Final Audit Report — `@selva/core`

**Date:** 2026-01-14  
**Scope:** `packages/core`  
**Inputs consolidated from:** [CLAUDE_AUDIT.md](CLAUDE_AUDIT.md), [COPILOT_AUDIT.md](COPILOT_AUDIT.md), [COPILOT_AUDIT_GPT.md](COPILOT_AUDIT_GPT.md)

---

## 1) Executive summary

`@selva/core` is a strong, well-structured TypeScript SDK for Rhino Compute / Grasshopper with a clean feature-sliced architecture, modern packaging, and a generally consistent error model.

The main gap across the reports is not architecture, but **production runtime contract clarity**:

- The package declares **Node >= 16**, but shipped runtime code relies on **`fetch`** and **`btoa/atob`**, and some modules rely on **browser-only APIs** (`document`, `Blob`).
- `three` is declared as an **optional peer dependency**, but current exports/import graph can still cause `three` to be required in consumer builds depending on what they import.

If you clarify and enforce runtime expectations (recommended: Node >= 18 for server-side) and isolate optional/browser-only concerns behind explicit entrypoints, this library is very close to “production ready”.

---

## 2) Overall assessment (combined)

These scores are a synthesis of the audits and repo inspection.

- **Architecture & Modularity:** A / A+  
  Feature slicing is clean and scalable.
- **Maintainability:** A  
  Mostly consistent patterns; a few large files and some boundary-type `any`.
- **Type Safety:** A-  
  Strong discriminated unions and typed config, but some `any` at boundaries.
- **Production Readiness:** B+ to A-  
  Depends heavily on clarifying runtime targets and optional dependency isolation.
- **Documentation:** B+ to A-  
  Good entrypoint docs + JSDoc; could use “runtime requirements” and advanced usage.
- **Testing:** B+  
  Good coverage for core + Grasshopper; gaps in visualization and file-handling.

---

## 3) Strengths

- Clean feature boundaries: `core` vs `features/grasshopper`, `features/visualization`, `features/file-handling`.
- Modern distribution: ESM+CJS with `exports` map, types for entrypoints, tree-shaking friendly (`sideEffects: false`).
- Error design is solid: `RhinoComputeError` includes `code` and optional `context` and `cause`.
- The high-level `GrasshopperClient` API is well designed (factory + validation + disposal pattern).
- Input processing has good structure (validation + parsing + safe defaults).

---

## 4) Key issues (highest impact)

### 4.1 Runtime contract mismatch (Node 16 vs actual requirements)

Observed in code:
- Global `fetch` usage in compute/server modules.
- `btoa/atob` usage in Grasshopper solve path.
- Browser-only API usage (`document.createElement`, `Blob`) in file download path.

Impact:
- Consumers can hit runtime crashes even when TypeScript compiles.

### 4.2 `three` is not reliably optional

Observed in code:
- `GrasshopperResponseProcessor` imports visualization helpers that import `three` at module load.

Impact:
- Some consumer bundles/builds may require `three` to be installed even if they don’t use visualization features.

### 4.3 Logging in shipped library code

Observed in code:
- Numerous `console.*` calls across compute fetch, server stats monitoring, input processing, and visualization.

Impact:
- Noisy logs in production apps; consumers can’t redirect logs to their own logger.

### 4.4 Inconsistent error types across public APIs

Observed in code:
- Some public-facing modules throw plain `Error` instead of `RhinoComputeError`.

Impact:
- Consumers can’t reliably branch on error codes; harder to build robust integrations.

### 4.5 Gaps in tests for visualization and file-handling

Impact:
- Higher regression risk in the most environment-sensitive code (browser vs Node, workers, compression).

---

## 5) Recommendations (prioritized)

### P0 — Decide and enforce runtime targets

Pick one strategy and reflect it consistently in code + docs + `package.json`:

1) **Server-first (recommended):** Require Node **>= 18** and treat global `fetch` as available.
2) **Portable SDK:** Support `fetch` injection in config (and avoid browser-only globals in shared paths).
3) **Polyfill-based:** Add an explicit fetch implementation (e.g. `undici`) and never rely on globals.

Also:
- Replace `btoa/atob` usage with a Node/browser-safe base64 encoding approach.

### P0 — Make `three` truly optional

Options:
- Lazy-load visualization inside `GrasshopperResponseProcessor.extractMeshesFromResponse()` via `await import(...)`.
- Or split the visualization-enabled processor into a separate explicit entrypoint.
- Or invert the dependency: accept a visualization adapter provided by consumer.

### P1 — Standardize errors + logging

- Make public APIs throw `RhinoComputeError` (use the existing error factory where appropriate).
- Gate `console.*` behind `debug` or accept a `logger` in config (so consumers can route logs).
- Remove/avoid `console.error` for non-error events (e.g. “starting monitoring…”).

### P1 — Browser-only guardrails

- For file downloads, explicitly guard:
  - If `document` is missing, throw `RhinoComputeError` describing that this function is browser-only.
- Consider exporting browser-only helpers only from `@selva/core/files` (not from root).

### P2 — Type improvements & simplification

- Replace boundary `any` with `unknown` + narrowing.
- Reduce complexity where it increases cognitive load (notably some parser logic).
- Consider splitting very large visualization modules into smaller internal modules.

### P2 — Tooling polish

- Remove unused `tsup` externals (if truly unused) to reduce confusion.
- Add package-level `lint` script (if not centralized at repo root).
- Consider coverage thresholds or diff-based coverage in CI.

---

## 6) Quick “definition of done” for production readiness

A minimal checklist that, once satisfied, would justify calling the package production-ready:

- Runtime contract documented and enforced (Node/browser requirements, `fetch`/base64 behavior).
- `three` optionality validated by a consumer test that imports `@selva/core/grasshopper` without `three` installed.
- File download APIs are browser-guarded and documented.
- Public APIs consistently throw `RhinoComputeError` (codes + context).
- No un-gated `console.*` output in default mode.
- Add baseline tests for visualization parsing and file-handling (at least smoke tests).

---

## 7) Appendix: notable hotspots (for follow-up PRs)

- Runtime/env assumptions:
  - `src/core/compute-fetch/compute-fetch.ts`
  - `src/core/server/compute-server-stats.ts`
  - `src/features/grasshopper/compute/solve.ts`
  - `src/features/file-handling/handle-files.ts`
- Optional dependency coupling:
  - `src/features/grasshopper/client/grasshopper-response-processor.ts`
  - `src/features/visualization/**`

