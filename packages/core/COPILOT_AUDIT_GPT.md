# Copilot Audit Report (GPT) — `@selva/core`

**Date:** 2026-01-14  
**Scope:** `packages/core` only (this VS Code workspace).  
**Repository:** `VektorNode/selva` (branch: `main`)

> Notes on scope: this workspace cannot read files outside `packages/core` (e.g. root CI workflows, root tsconfig base). Recommendations that depend on those are marked accordingly.

---

## 1) Executive summary

The codebase has a solid, feature-sliced structure and a good foundation (ESM/CJS builds via `tsup`, `vitest`, shared ESLint config, error types). The largest production-readiness gap is **runtime environment consistency**: the package claims **Node >= 16**, but core runtime code uses **`fetch`** and **`btoa/atob`**, and one high-level Grasshopper API **eagerly imports Three.js** despite `three` being an optional peer dependency.

If you intend this library to be safe for production usage server-side, the top priority is to **make the runtime contract explicit and enforce it** (either require Node >= 18 and a browser-like global environment, or inject polyfills / avoid browser-only globals).

---

## 2) Strengths (keep)

- **Clear modularity and feature boundaries**
  - Feature folders are well organized (`src/core`, `src/features/grasshopper`, `src/features/visualization`, `src/features/file-handling`).
- **Modern packaging**
  - Dual output (`esm` + `cjs`), `exports` map in `package.json`, `sideEffects: false`, source maps, d.ts generation.
- **Centralized error type**
  - `RhinoComputeError` provides `code`, `context`, and optional `cause` support.
- **Test harness exists and is used**
  - `vitest` setup, multiple unit tests, and coverage reporters configured.

---

## 3) High-risk production-readiness issues

### 3.1 Node version / runtime mismatch (Node 16 is not enough)

**Evidence**

- `src/core/compute-fetch/compute-fetch.ts` uses global `fetch`.
- `src/core/server/compute-server-stats.ts` uses global `fetch`.
- `src/features/grasshopper/compute/solve.ts` uses browser globals `btoa` and `atob`.
- Tests set `global.fetch = vi.fn()` and use `Blob` in `tests/helpers/mock-fetch.ts`, which aligns more naturally with Node >= 18.

**Why it matters**

- Node 16 **does not provide** `fetch` globally.
- Node 16 also does not reliably provide `btoa/atob`.
- Consumers will experience runtime crashes that TypeScript cannot prevent.

**Recommendation (pick one strategy and make it consistent)**

1. **Server-first strategy:** bump `engines.node` to **>= 18** and document that `fetch` is expected to exist.
2. **Portable strategy:** allow passing an injected `fetch` implementation (e.g. `config.fetch?: typeof fetch`), and internally fall back to `globalThis.fetch` if present.
3. **Polyfill strategy:** add an explicit dependency such as `undici` (or a small fetch wrapper), and ensure the library never depends on `globalThis.fetch`.

### 3.2 Optional `three` peer dependency is effectively not optional

**Evidence**

- `src/features/grasshopper/client/index.ts` re-exports `GrasshopperResponseProcessor`.
- `src/features/grasshopper/client/grasshopper-response-processor.ts` imports `getThreeMeshesFromComputeResponse` from visualization.
- Visualization modules import `three` at top-level (e.g. `src/features/visualization/webdisplay/webdisplay-parser.ts`, `src/features/visualization/webdisplay/batch-parser.ts`).

**Why it matters**

- In ESM, re-exporting from a module typically causes the dependency graph to be loaded; in many consumer setups this will force `three` to be resolvable even if the consumer never calls visualization methods.
- This undermines the package’s intent of `three` being optional.

**Recommended fixes**

- Split the processor into a separate entrypoint that is explicitly “visualization-enabled”, e.g. `@selva/core/grasshopper-visualization`.
- Or refactor `GrasshopperResponseProcessor.extractMeshesFromResponse()` to **lazy import** visualization modules (`await import(...)`) so `three` is only required when that method is invoked.
- Alternatively, make visualization integration an optional adapter passed in from the outside (dependency inversion).

### 3.3 Browser-only file download API ships without environment guards

**Evidence**

- `src/features/file-handling/handle-files.ts` uses `Blob` and `document.createElement('a')`.
- `src/index.ts` exports file-handling from the main entry.

**Why it matters**

- Calling `downloadFileData()` in Node will crash (no `document`), and `Blob` may be missing depending on Node version.

**Recommendations**

- Document `downloadFileData()` as **browser-only** and guard it at runtime:
  - If `typeof document === 'undefined'`, throw a `RhinoComputeError` with a clear message.
- Consider moving browser-only helpers behind the `@selva/core/files` subpath only (avoid exporting them from the package root).

---

## 4) Maintainability and simplification opportunities

### 4.1 Logging strategy: too much `console.*` in library runtime

**Evidence**

- Many runtime modules call `console.warn/error/log/info` directly:
  - `src/core/compute-fetch/compute-fetch.ts` logs warnings (API key missing).
  - `src/core/server/compute-server-stats.ts` logs `console.error` on monitor start and `console.info` on fetch error.
  - `src/features/grasshopper/io/input/input-processors.ts` logs validation errors.
  - Visualization parsing uses `console.*` for debug/perf output.

**Why it matters**

- Libraries should avoid noisy logs in production apps.
- Logging should be controllable and ideally integrable into the consumer’s logger.

**Recommendations**

- Provide a simple logger interface in config (e.g. `logger?: { debug/info/warn/error }`) or a `logLevel`.
- Ensure all logs are gated behind `config.debug` / `options.debug`.
- Avoid `console.error` for non-error events (e.g. “starting monitor…”).

### 4.2 Inconsistent error types (`Error` vs `RhinoComputeError`)

**Evidence**

- `src/features/file-handling/handle-files.ts` throws `new Error(...)`.
- `src/core/server/compute-server-stats.ts` throws `new Error(...)`.
- Core already has an error factory (`src/core/errors/error-factory.ts`).

**Why it matters**

- Consumers can’t reliably catch and branch on error codes.

**Recommendations**

- Use `RhinoComputeError` consistently for public APIs.
- Consider using `ConfigErrors.invalid(...)` / `ConfigErrors.missingRequired(...)` and similar factories.

### 4.3 Redundant validation / small correctness issues

**Evidence**

- `src/features/grasshopper/io/definition-io.ts` checks `if (!response || typeof response !== 'object')` twice.

**Recommendation**

- Remove duplicated checks; keep one validation block.

### 4.4 Type safety leaks via `any` and untyped external schemas

**Evidence (examples)**

- `src/core/compute-fetch/compute-fetch.ts` returns `Promise<any>` from `handleResponse()` and uses `Record<string, any>` for args.
- `src/features/grasshopper/types/trees.ts` uses `DataTreeDefault<T = any>` and `data: any`.
- Output response processing uses many `any` types (`src/features/grasshopper/io/output/response-processors.ts`, `rhino-decoder.ts`).

**Why it matters**

- `any` negates the value of TypeScript in the most critical boundary areas (I/O and schema parsing).

**Recommendations**

- Prefer `unknown` at boundaries, then narrow.
- Use generics for “payload decode” utilities.
- For Grasshopper IO schemas, define minimal runtime validators for expected shapes (even lightweight checks) to prevent unsafe assumptions.

### 4.5 Large files and cognitive load

**Evidence**

- `src/features/visualization/threejs/three-initializer.ts` is very large (hundreds of lines) and contains many responsibilities.

**Recommendations**

- Split into modules by concern (renderer setup, camera/controls, materials, environment, selection, helpers).
- Ensure the public API remains stable; refactor internals only.

---

## 5) Build, packaging, and dependency hygiene

### 5.1 Unused externals in `tsup` config

**Evidence**

- `tsup.config.ts` lists `external: ['three', 'file-saver', 'jszip', 'jszip-utils']`.
- No references to `jszip`, `jszip-utils`, or `file-saver` were found in `src/`.

**Recommendation**

- Remove unused externals to reduce confusion and maintenance overhead.

### 5.2 Package naming inconsistencies

**Evidence**

- Comments/docs refer to `rhino-compute-core` in multiple places, while the package name is `@selva/core`.

**Recommendation**

- Update examples and module docs to match the published package name and subpath exports.

---

## 6) Testing and quality gates

### 6.1 Coverage configuration exists, but no thresholds

**Evidence**

- `vitest.config.ts` enables coverage reporters but does not define minimum thresholds.

**Recommendation**

- Add pragmatic thresholds (even modest ones) or use “diff coverage” in CI (if CI exists in the repo root).

### 6.2 Missing lint script in this package

**Evidence**

- `package.json` lacks `lint` / `format` scripts.

**Recommendation**

- Add `lint` script for package-level developer UX (unless it is intentionally centralized at repo root).

---

## 7) Prioritized action plan

### P0 (must fix before calling this “production ready”)

- Align runtime contract:
  - Decide on Node target (>=18 recommended) OR implement `fetch` injection.
  - Remove `btoa/atob` usage from server-capable paths.
- Make `three` truly optional:
  - Remove eager visualization imports from core grasshopper entrypoints.

### P1 (high value, low risk)

- Gate all logging behind `debug` or provide injectable logger.
- Standardize public API errors to `RhinoComputeError` and use the error factory.
- Add browser-only guards for download helpers.

### P2 (incremental maintainability improvements)

- Replace boundary `any` with `unknown` + narrowing.
- Split large visualization initializer into smaller modules.
- Remove redundant checks and dead config (unused tsup externals).

---

## 8) Checklist of questions to confirm intent (for future work)

These are decisions that affect which recommendations are “correct”:

- Is `@selva/core` intended to be **server-first** (Node) or **browser-first** (Web)?
- Should the root export (`@selva/core`) be “everything”, or should it be a minimal core with optional subpath modules?
- Is visualization meant to be tree-shaken-only, or should it be fully isolated behind explicit imports?

---

## Appendix: concrete file hotspots

- Runtime environment assumptions:
  - `src/core/compute-fetch/compute-fetch.ts` (global `fetch`, noisy warning)
  - `src/core/server/compute-server-stats.ts` (global `fetch`, un-gated console output)
  - `src/features/grasshopper/compute/solve.ts` (`btoa/atob`)
- Optional dependency coupling:
  - `src/features/grasshopper/client/grasshopper-response-processor.ts` (imports visualization)
  - `src/features/visualization/webdisplay/*` (imports `three`)
- Browser-only:
  - `src/features/file-handling/handle-files.ts` (`document`, `Blob`)
