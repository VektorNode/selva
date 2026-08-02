# Exposing the solved artifact to solve-session consumers

**Status: reviewed, ready to implement.** Written from the Parafa side 2026-08-02 after adopting
`SolveEngine` server-side; revised 2026-08-02 after cross-checking against Parafa's live solve page.

## The gap

`createComputeFetchSolveFn` ([client/compute-fetch-solve-fn.ts](../../packages/solve/src/client/compute-fetch-solve-fn.ts))
parses the wire response into a `SolveResult` and drops the raw
`GrasshopperComputeResponse` on the floor — `solved` is local to the closure and never escapes
(`:173`, `:225`). For a preview-only consumer (Selva's `library/[guid]` page) that is exactly right.

For a consumer with a **commit/persist step** it is a hard blocker. Parafa's
Speichern / Generieren / Freigeben gestures persist the _exact on-screen result_ — never a
re-solve — because a re-solve can legitimately differ (compute-side `cachesolve`, non-determinism,
a definition republished between preview and commit). So its `onSolve` must retain the raw
response, and does:

```ts
// parafa: src/routes/app/solve/[guid]/+page.svelte:419-420
lastValues = values;
lastSolved = solved; // ← the raw GrasshopperComputeResponse the commit path sends back up
```

Result: Parafa adopted `SolveEngine` server-side (clean win, ~180 lines deleted) but had to keep a
hand-written `onSolve`, re-deriving the 429 cooldown / session-expiry / non-JSON-guard behavior the
factory already owns — the exact duplication the facade exists to end.

**This is not Parafa-specific.** Any consumer that quotes, orders, versions, or archives a solve
result needs the artifact it showed the user, not a promise to recompute it.

## This is a live bug, not only a blocked refactor

The workaround above is **already broken in production code**, silently.

`ComputeApp` wires the memoizing request/response driver
([ComputeApp.svelte:116](../../packages/ui/src/lib/components/compute/ComputeApp.svelte#L116)), and
that driver short-circuits on a memo hit without ever calling `onSolve`
([drivers/request-response.ts:29-34](../../packages/solve/src/client/drivers/request-response.ts#L29-L34)):

```ts
const cached = memo.get(values);
if (cached !== undefined) {
	if (signal.aborted) return;
	getReporter().report(cached);
	return; // ← onSolve is NEVER called
}
```

Parafa assigns `lastSolved`/`lastValues` **inside** `onSolve`. So:

> solve A → solve B → scrub an input back to A → memo hit → viewer shows A,
> `lastSolved` still holds **B**.

Pressing _Freigeben_ then commits B's file artifacts under A's inputs — immutably, since approved
versions are frozen forever ([ADR-0010](../../../parafa/docs/adr/0010-file-artifacts-versioned.md)).
`hasNonEmptyOutput(lastSolved)` passes happily; nothing detects it. The memo caps at 16 entries and
a slider scrub round-trips through prior values constantly, so this is reachable in ordinary use,
not a corner case.

**Reproduce this first.** The test in step 3 below is the regression test for it.

The consequence for the design: any fix must be **memo-correct** — the artifact has to travel _with_
the result through the memo, not alongside it via a side channel. An
`onRawResponse?: (r) => void` option fired inside the `SolveFn` reintroduces exactly the bug above.

## Option A — carry it on `SolveResult` (rejected)

Add `raw?: GrasshopperComputeResponse` to `SolveResult`. Memo-correct for free (the memo stores
whole `SolveResult`s). But `SolveResult` lives in `shared/`, the vocabulary **both halves** speak,
and it is deliberately renderer- and transport-agnostic — `TMesh` is opaque specifically so no
renderer type leaks in ([shared/solve-fn.ts:8-13](../../packages/solve/src/shared/solve-fn.ts#L8-L13)).
A Grasshopper-specific field there breaks that boundary for every consumer, including ones that
never touch Grasshopper. Rejected.

## Option B — an opaque `source` slot on `SolveResult` (chosen)

Same memo-correctness, without naming Grasshopper in `shared/`:

```ts
// shared/solve-fn.ts
export interface SolveResult<TMesh = unknown, TSource = unknown> {
	outputs: Record<string, unknown>;
	meshes?: TMesh[];
	errors?: string[];
	warnings?: string[];
	/**
	 * The unparsed payload this result was built from, passed through verbatim. Opaque to this
	 * package (same reasoning as `TMesh`): a consumer that must persist or re-submit exactly what
	 * it showed the user narrows it at its own seam. Travels with the result through the driver's
	 * memo, so a cached hit carries the source that produced it. Unlike `meshes` it needs no
	 * ownership policy — it is inert data, not a GPU-backed handle.
	 */
	source?: TSource;
}
```

`createComputeFetchSolveFn` then sets `source: solved`, narrowing to
`SolveResult<TMesh, GrasshopperComputeResponse>` — the Grasshopper type stays in `client/`, which
already imports it. Consumers that ignore `source` are unaffected; the parameter defaults to
`unknown`, so no existing signature changes.

**Verified: the memo needs no change.** `copy()` spreads the whole result and only replaces
`meshes` ([solve-memo.ts:63-66](../../packages/solve/src/client/solve-memo.ts#L63-L66)), so `source`
rides along by reference automatically, both on `set` and on every hit.

### No `keepSource` flag

The earlier draft proposed gating population behind an opt-in flag on retention grounds. Dropped
after looking at what the memo actually holds: 16 entries max, each already carrying parsed
`outputs` plus decoded THREE meshes. GPU-backed geometry dwarfs a JSON response — this is closer to
+30% than 2×, and only for consumers that read it. A flag buys little and adds a permanent branch
plus a new way to be wrong (opt in, then wonder why `source` is `undefined`). Add it later if a real
consumer measures a problem.

## Option C — a second driver hook (rejected)

Extend `SolveDriver`/`SolveReporter` so the raw payload rides the report path. Memo-correct, but it
widens the driver seam — the extension point reserved for a future push/WebSocket transport — to
carry a payload only the request/response driver produces. Wrong layer for what is really a
result-shape concern. Rejected.

## The second half: `lastValues` is stale the same way

`source` alone does **not** close the bug. A commit needs the artifact _and_ the input set that
produced it, and Parafa captures both inside `onSolve`. On a memo hit neither is refreshed.

`session.values` is not a substitute: it is the **live form map**
([solve-session.ts:78-80](../../packages/solve/src/client/solve-session.ts#L78-L80)), which a user
editing after a solve mutates. Reading it at commit time gives current form state, not what was
solved.

The fix is small, because the driver already holds the values at report time — it just doesn't pass
them on. Two candidate shapes:

- **B1 — widen the report path.** `SolveReporter.report(result, values)`, with the session storing
  `lastSolvedValues` alongside the result and exposing it as a getter. Correct for every driver
  (a push transport knows its own input set too) and puts the pairing where the state machine
  already lives. Costs a signature change to `SolveReporter` and `SolveSession.report`, plus the
  `useSolveSession` republish.
- **B2 — fold values into `SolveResult`.** Add `values?: Record<string, unknown>` next to `source`,
  populated by the driver (not the `SolveFn` — it must survive a memo hit, and the driver is what
  has both). No signature change anywhere; the memo carries it for free like `source`.

**Recommendation: B2.** It keeps "what was shown" as one atomic object, which is the whole point —
a consumer holding a `SolveResult` cannot accidentally pair it with the wrong inputs. B1 leaves two
things to keep in sync at every call site. Decide before step 4; either way the pairing must be
settled or Parafa deletes its `onSolve` and keeps half the bug.

Note the driver must set this on the memo-hit branch too — the cached result's stored `values` are
the right ones (they keyed the entry), so `memo.get` returning them intact is sufficient.

## Migration

1. Add `TSource` + `source` (and per B2, `values`) to `SolveResult` — additive, defaulted, no
   consumer breaks.
2. Populate `source` in `createComputeFetchSolveFn`; populate `values` in
   `createRequestResponseDriver` on both the fresh-solve and memo-hit paths.
3. **Regression test, first and regardless of which option ships:** solve A → solve B → solve A
   again (memo hit) and assert the reported result's `source` _and_ `values` are A's, not B's. This
   is the test that catches both the naive design and the bug Parafa has today.
4. Parafa deletes its hand-written `onSolve`, adopts the factory, reads `source`/`values` off the
   reported result instead of closure variables, and picks up the 429 cooldown and session-expiry
   handling it currently lacks.
5. Parafa's `// per ADR-0010's interactive-path note` comment
   ([+page.svelte:237](../../../parafa/src/routes/app/solve/[guid]/+page.svelte#L237)) cites the
   wrong document — ADR-0010 is the file-artifacts-versioning decision and does not establish the
   commit-the-exact-preview invariant. Fix the reference or write the invariant down where it
   belongs.

## Why this is worth doing

The server half of the facade landed and immediately paid off — Parafa deleted three files and ~180
lines. The client half is blocked for one narrow, fixable reason, and the workaround consumers reach
for in the meantime is quietly wrong. Fixing it makes `createComputeFetchSolveFn` usable by the whole
class of consumers that _do something_ with a solve result rather than only displaying it, which is
most real products built on the engine.

Cost is proportionate: two additive fields in `shared/`, one line in the factory, one in the driver,
one test. Blast radius is nil for existing consumers.
