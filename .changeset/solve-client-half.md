---
'@selvajs/visualization': major
'@selvajs/solve': minor
'@selvajs/ui': minor
---

The solve session moves out of `@selvajs/visualization` into `@selvajs/solve/client`.

`@selvajs/visualization` is now **mesh conversion + viewer, and nothing else**. The session was a
schema-driven form state machine that typed meshes as `unknown` and never inspected one — its
presence was why the package couldn't be described in a sentence. With it gone the package also
drops its last Selva dependency (`@selvajs/schemas`), so every sub-path needs only `three`,
`rhino3dm` and `fflate`.

**Breaking — `@selvajs/visualization`:**

- **The `/session` sub-path export is removed.** Import from `@selvajs/solve/client` instead
  (`createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`,
  `createSolveMemo`, `stableInputKey`, the external-input storage helpers, the pure
  `solve-session-core` transitions). `SolveFn`/`SolveResult` come from `@selvajs/solve/shared`.
- The root barrel no longer re-exports any of the above.
- `@selvajs/ui` re-exports all of it unchanged, so hosts importing from `@selvajs/ui` or
  `@selvajs/ui/public` need no edit.

**Renamed — `createComputeThrottle` → `createAsyncThrottle`** (`isComputing` → `isRunning`). It is
generic over `T`, takes any `(values, signal) => Promise<void>`, and mentions neither Rhino.Compute
nor HTTP nor geometry — plugin-ui drives it over a WebSocket. The old name said "compute" only
because of where the file happened to live.

**Mesh ownership is now injected, not assumed.** `SolveResult<TMesh>` is opaque and the result memo
no longer imports `three`; the clone/dispose rules are a `MeshPolicy` passed in. The three.js
implementation is `meshPolicy`, newly exported from `@selvajs/visualization/parse`:

```ts
import { meshPolicy } from '@selvajs/visualization/parse';
const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
```

`ComputeApp` wires this for you. A custom driver must pass it, or a memo hit will serve geometry the
viewer already disposed. `createSolveMemo(max)` accordingly becomes
`createSolveMemo({ max, meshPolicy })`.

**Fixed while extracting it:** the memo's mesh clone copied `geometry.userData` **by reference**, so
a cloned geometry shared the cross-solve geometry cache's ownership flag. `clearScene` skips flagged
geometries (the cache disposes those itself), which meant nothing ever freed the memo's clones. The
clone now copies `userData` before dropping the flag, and `releaseSceneObjects` refuses to dispose
genuinely cache-owned geometry.
