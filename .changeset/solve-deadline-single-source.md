---
'@selvajs/server': major
'@selvajs/solve': major
'@selvajs/ui': major
'@selvajs/selva': minor
---

One name, one value, for how long a solve may run. The deadline is now sourced
from the server and carried unchanged to the browser's `AbortController`, rather
than each layer keeping its own answer under its own name.

**Fixed — the client could abort a solve the server would have finished.** The
throttle defaulted to `60_000` while the server's deadline was `100_000`, so any
host that embedded `<ComputeApp>` without passing a timeout aborted at 60 s a
solve the server was still happily running. The user saw a failure for work that
succeeded. `@selvajs/solve` can't read env, so the fix is to require the value
rather than guess it — there is no client-side default left to drift.

**Breaking — the per-solve deadline is now required:**

- `createAsyncThrottle`: `options.timeout` → **`options.runDeadlineMs`**, required,
  and the options bag itself is no longer optional. The name says what elapses;
  the throttle is generic, so its field is named after a run, not a solve.
- `createRequestResponseDriver`: `options.timeout` → **`options.solveDeadlineMs`**,
  required.
- `ComputeApp`: `solveTimeoutMs?` → **`solveDeadlineMs`**, required. Pass the value
  the server enforces; omitting it is now a type error rather than a silent 60 s.
- `ComputeLimits.maxSolveDurationMs` → **`solveDeadlineMs`**.

**Renamed — `MAX_SOLVE_DURATION_MS` → `COMPUTE_SOLVE_DEADLINE_MS`.** It joins the
`COMPUTE_*` namespace every other compute knob already uses, and says what it
bounds — one solve — instead of a vague "duration". The old name still works for
one minor version and warns at boot, so no deployment breaks on upgrade.

**`selva migrate` now rewrites deprecated env keys in your `.env`**, so a tuned
value survives the shim being dropped later instead of silently reverting to a
default. Only the key changes — value, comments, ordering and spacing are left
byte-identical, a commented-out old name is ignored, and the old line is dropped
outright when the new name is already set. `.env.bak` is written alongside the
existing backups and restored if the migration rolls back.

`selva doctor` reports the same deprecations without changing anything, covering
this rename plus the four that were previously silent
(`COMPUTE_DEFINITION_BYTE_CACHE_MB`, `COMPUTE_RESPONSE_CACHE_MB`,
`DEFINITION_CACHE_TTL_MS`, `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE`). The last of those
is reported but not auto-fixed: its replacement encodes a value
(`SELVA_FLAG_COMPUTE_DEBUG=verbose`), so migrate won't guess at it.

Migration: run `selva migrate` to rewrite the env var, and pass `solveDeadlineMs`
wherever you mount `ComputeApp` or build a driver.
