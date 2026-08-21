# Surfacing the reported `SolveResult` to a `ComputeApp` host

**Status: complete, archived 2026-08-16.** Every item shipped and released — the retained
`source`/`values` on `SolveSession.lastResult`, the `track()` getter on `useSolveSession`, the
`getLastResult` handoff on `ComputeApp`'s `onReady`, and all four tests. The seam was built as a
getter; the `onSolveResult` callback alternative was rejected.

Follow-up to `solve-fn-raw-response`, which shipped in `0.2.0-beta.4` (commit `64c954ef`). That
plan file was deleted rather than archived, so the link is to the commit, not a document. That change is correct and complete **within
`@selvajs/solve`**. This one covers the last hop: `@selvajs/ui` has no seam to hand the
result to the app embedding `ComputeApp`, so the new fields dead-end one layer short of
the consumer they were added for.

## Where it stops

The plumbing is right up to the session:

1. `createComputeFetchSolveFn` sets `source: solved`. ✅
2. `createRequestResponseDriver` stamps `values` and stores the pair in the memo. ✅
3. `session.report(result)` receives the whole `SolveResult`. ✅
4. `applySolveResult` keeps `errors`/`warnings`/`meshes`, does
   `Object.assign(state.values, result.outputs)` — and **drops `source` and `values`**
   ([solve-session-core.ts:96-105](../../packages/solve/src/client/solve-session-core.ts#L96-L105)).
5. `ComputeApp` exposes `onReady?: (api: { loadValues })` and nothing else outbound
   ([ComputeApp.svelte:56](../../packages/ui/src/lib/components/compute/ComputeApp.svelte#L56)).

So a host passing `onSolve` into `ComputeApp` cannot observe the result the viewer is
actually showing. `SolveSession` is public and `report()` is on its interface, but the host
never touches the session — `ComputeApp` constructs it internally and keeps it.

## Why this is not just one host's problem

The `solve-fn-raw-response` changeset documents the failure mode precisely:

> Capturing the raw response inside your own `SolveFn` is silently wrong behind
> `createRequestResponseDriver`: a memo hit serves the cached result without ever calling
> the `SolveFn`.

That is exactly the workaround every `ComputeApp` host is currently forced into, because
`onSolve` is the only seam they have. **The fix landed in the layer that had the bug, but
the layer that forces the bug is unchanged.** Any host with a commit/persist step —
quoting, ordering, versioning, archiving — writes the broken pattern by construction, and
now does so against a package whose docs correctly tell them not to.

Concretely, in a downstream host today (`solve/[guid]/+page.svelte:419-420`):

```ts
lastValues = values; // captured inside onSolve
lastSolved = solved; // …which a memo hit never runs
```

Solve A → solve B → scrub back to A. The memo (16-entry LRU, keyed on a stable
serialization of all values, unconditionally enabled in `ComputeApp`) serves A. The viewer
shows A. `lastSolved` still holds B. Freigeben then commits B's geometry and files while
the user is looking at A — and freezes it, since approve is commit-and-lock. That is the
ADR-0010 invariant inverted by the very mechanism meant to uphold it.

_Not yet reproduced live — inferred from reading both sides. Worth confirming before
treating the severity as settled, though the code path is unambiguous._

**Bounded, though.** The memo only serves within one session whose `definitionKey` has not
changed — `rebuild()` calls `driver.clearCache?.()`, so switching definitions wipes it — and
it holds 16 entries. So the window is "a scrub back to a recently-visited value set, same
definition, same session", not "any commit path". Real, and reachable in ordinary slider
use, but narrower than the framing above might suggest on its own.

## What to add

Two changes, both additive.

### 1. Retain the fields on the session (`@selvajs/solve`)

`applySolveResult` currently discards them. Keep the last reported result addressable —
**without meshes**:

```ts
// solve-session-core.ts

/** The retained slice of a reported result. Deliberately mesh-free — see below. */
export type RetainedSolveResult = Omit<SolveResult, 'meshes'>;

export interface SolveSessionState {
	// …existing
	lastResult: RetainedSolveResult | null;
}

export function applySolveResult(state: SolveSessionState, result: SolveResult) {
	// …existing assignments
	const { meshes: _meshes, ...retained } = result;
	state.lastResult = retained; // carries source + values, already memo-correct
	return state;
}
```

and expose it on `SolveSession`:

```ts
readonly lastResult: RetainedSolveResult | null;
```

**Meshes must not be retained.** `SolveResult.meshes` are GPU-backed and the viewer disposes
what it renders on the next scene update — which is the entire reason the memo carries a
`MeshPolicy` clone/release contract ([solve-memo.ts:1-10](../../packages/solve/src/client/solve-memo.ts#L1-L10),
and two prior leaks on this seam). A session field holding the reported result would hand a
host **disposed instances** after the next solve, with no policy governing them and no
owner. Dropping `meshes` from the retained slice sidesteps ownership entirely: everything
left (`outputs`, `errors`, `warnings`, `source`, `values`) is inert JSON. Live meshes remain
available where they already are, on `session.meshes`.

`rebuild()` must also null it. It already clears `state.meshes`/`error`/`computeErrors` and
calls `driver.clearCache?.()` because the new definition has its own input space
([solve-session.ts:130-149](../../packages/solve/src/client/solve-session.ts#L130-L149)); a
`lastResult` surviving that would belong to the _previous_ definition — the same
cross-definition staleness `clearCache` exists to prevent.

**`reportError` should leave `lastResult` in place** — a deliberate choice, not an
oversight. After a failed solve the viewer still shows the last good geometry
(`reportError` sets `state.error` and touches nothing else), so a host committing what is
on screen should still see the result that produced it. Stating it explicitly because the
opposite is equally defensible and the difference is silent.

**Decided: no generics.** `lastResult` stays `RetainedSolveResult | null` with `TSource` at
its `unknown` default, and `SolveSession` stays unparameterized (it is already
`meshes: unknown[]`). Threading `TSource` through the session, `useSolveSession` and
`ComputeApp`'s props is a larger change than this needs, and the host narrows at its own
seam exactly as it already does for `TMesh`. With `meshes` dropped from the retained slice
`TMesh` is moot here anyway.

`RetainedSolveResult` must be exported from `@selvajs/solve/client`'s barrel alongside
`SolveSession` ([index.ts:15-31](../../packages/solve/src/client/index.ts#L15-L31)) — the
`solve-session-core` block re-exports its types, so it belongs there — otherwise
`@selvajs/ui` cannot annotate the `onReady` api in §2.

**`lastResult` lags `session.values` by design.** Nothing updates it on `setValue` or
`loadValues`, so between a value change and the next report it describes the _previous_
input set while `session.values` has already moved on. That is what a commit gate wants —
what is on screen, not what is pending — but it means a host comparing `getLastResult().values`
against `session.values` will see them disagree mid-scrub, and that disagreement is the
feature. Says so on the field, since the opposite reading is the one that causes the bug.

### 1b. The second consumer, and why `values` stays driver-supplied (`@selvajs/plugin-ui`)

`@selvajs/ui`'s `ComputeApp` is **not** the only thing building a `SolveSession`.
`usePreviewState` ([usePreviewState.svelte.ts:55](../../packages/plugin-ui/src/lib/composables/usePreviewState.svelte.ts#L55))
builds one over `websocket-solve-driver` — a different transport, with **no memo and no
`values` stamp**. Its report call passes outputs and meshes only
([websocket-solve-driver.ts:203-206](../../packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts#L203-L206)):

```ts
getReporter().report({
	outputs: { ...(message.outputs ?? {}), ...(message.fileOutputs ?? {}) },
	...(sceneObjects !== undefined ? { meshes: sceneObjects } : {})
});
```

So on that path `lastResult` would be permanently `{ source: undefined, values: undefined }`
— a _partially_ populated object rather than an obvious failure, which is the worst shape
for a host to consume. `values` in particular is driver-supplied by construction: the
request/response driver stamps it because it owns the input set at report time, and the
push driver does not.

**Decided: document as driver-supplied, do not stamp.** The obvious-looking fix — have the
websocket driver carry the values it last sent onto the report — was considered and
rejected, because it cannot be made correct there:

- **Reports are not responses.** `handleOutputs` fires on any `outputs` frame the socket
  delivers. Two of those have no preceding local `solve()` at all: `primeFromInitialData`
  ([websocket-solve-driver.ts:227-231](../../packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts#L227-L231))
  replays the last solve on connect, and editing the definition in Grasshopper makes the
  plugin recompute and push. A "last values I sent" variable would stamp those frames with
  an unrelated input set — the same stale pairing this plan exists to close, reintroduced in
  a driver with no memo to blame it on.
- **The values it holds are a different set anyway.** `solve()` sends
  `prepareValuesForSend(values)`, which drops file-metadata entries
  ([:44-65](../../packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts#L44-L65)).
  Stamping the raw map claims inputs Grasshopper never received; stamping the prepared map
  omits keys the request/response driver includes. The field would not mean the same thing
  across drivers, which is the only reason to make it driver-wide.

A push transport genuinely does not know what produced a frame. `values` is meaningful
exactly where a driver owns the request/response pair, and pretending otherwise buys a
guarantee that is wrong rather than absent.

**So absence must be specified, not silent** — otherwise the original objection stands (a
host cannot tell "no solve yet" from "this transport never populates it"). Two doc changes
carry that, both in `@selvajs/solve`:

1. `SolveDriver`'s doc comment states the obligation: a driver that owns a request/response
   pair MUST stamp `values` on the result it reports; a push driver that cannot attribute a
   frame to a request MUST leave it absent rather than guess.
2. `SolveResult.source`/`values` say they are driver-supplied and name the condition under
   which they are present, so `lastResult.values === undefined` reads as a documented
   property of the transport.

Hosts needing the pair therefore require a request/response driver — which is what every
`ComputeApp` consumer already uses, and `ComputeApp` wires it unconditionally.

Note also that `usePreviewState` is a _consumer_ of `SolveSession`, not a second
implementation of it, so adding a member does not break it structurally. The real cost is
semantic, above.

### 1c. The adapter republish is not one line

`useSolveSession` is a complete, explicit republish of the `SolveSession` surface —
every member is listed by hand
([useSolveSession.svelte.ts:49-82](../../packages/ui/src/lib/compute/useSolveSession.svelte.ts#L49-L82)),
deliberately, so no mirrored copy can drift. Adding `lastResult` means adding a
`track()`-wrapped getter there, or the field reads correctly but never re-renders.

**It is the only one.** `usePreviewState` looked like a second republish but is not: it
reads `session?.values` through its own getters and returns its own shape, never a
`SolveSession`. Its `PreviewSession` interface
([preview-state-core.ts:50-54](../../packages/plugin-ui/src/lib/composables/preview-state-core.ts#L50-L54))
is a deliberately narrow slice — `values`/`loadValues`/`rebuild` — that a structural widening
does not touch. So this is one edit plus a grep to confirm no third appears later, not a
cross-package checklist.

### 2. Give `ComputeApp` an outbound seam (`@selvajs/ui`)

Preferred — widen the existing `onReady` api rather than adding a parallel prop:

```ts
onReady?: (api: {
    loadValues: (values: Record<string, unknown>) => void;
    /** The last result reported to the session, including `source`/`values`. Null before the first solve. */
    getLastResult: () => RetainedSolveResult | null;
}) => void;
```

A getter, not a snapshot: `onReady` fires once, so a value would be permanently stale.
Hosts already hold the api object (one host keeps it as `computeApi`), so this costs them
nothing structurally and cannot break an existing caller.

**Alternative considered — an `onSolveResult?: (result: SolveResult) => void` prop.** More
discoverable, and push-shaped so a host can react rather than poll. But it needs care that
it fires on a _memo hit_ too, not only on a fresh solve — the entire point. Wiring it to
`session.report()` gets that for free; wiring it near `onSolve` reintroduces the original
bug in a new place. If you prefer this shape, wire it at the report funnel and add the
regression test below against it specifically.

Both could ship; the getter is the smaller, safer core.

## Regression tests

1. **Memo correctness, one layer out** — the same shape that guards the
   `solve-fn-raw-response` fix: solve A, solve B, solve A again, assert what the **host**
   observes is A's `source`, not B's. This is the assertion that distinguishes a correct
   wiring from one attached to `onSolve`, and it should exist regardless of which seam ships.
2. **No retained meshes** — assert `lastResult` has no `meshes` key, so a later refactor
   cannot quietly reintroduce the disposed-instance hazard by spreading the whole result.
3. **`rebuild()` clears it** — solve, rebuild with a different schema, assert
   `lastResult === null`.
4. **`reportError` preserves it** — solve, then `reportError`, assert `lastResult` still
   holds the last good result (locking in the decision above rather than leaving it to
   drift).

## Migration for downstream hosts

Once both land, such a host:

1. Replaces its hand-written `onSolve` with `createComputeFetchSolveFn`, picking up the
   429 cooldown, session-expiry detection and non-JSON guarding it currently lacks.
2. Reads `lastSolved`/`lastValues` from `getLastResult()` at the commit gestures
   (Speichern / Generieren / Freigeben) instead of from closure state, closing the
   stale-commit hole.
3. Deletes its local `GrasshopperResponseProcessor` + mesh-extraction block from both
   `solve/[guid]` and `jobs/[id]/batch`, which the factory's `meshes.extract` hook covers.

Until then the host keeps the hand-written `onSolve` and should carry a defensive guard —
the upgrade to `0.2.0-beta.4` is inert for it, since nothing it can reach exposes the new
fields.

## Scope note

Narrow in concept — `solve-fn-raw-response` already established that the payload travels
_with_ the result through the memo; this only makes the arrival point reachable. No driver
rework, no generics threading.

It is not, however, a two-file change. Ordered — no open decisions remain; §1b and the
generics question are both settled above:

1. `@selvajs/solve` docs: the `SolveDriver` stamping obligation and the
   `source`/`values` driver-supplied wording (§1b). First, so the field's contract exists
   before anything reads it.
2. `@selvajs/solve`: `RetainedSolveResult` (+ barrel export), `applySolveResult`,
   `rebuild()` nulling it, the `SolveSession` member, tests 1–4.
3. `useSolveSession`: one `track()`-wrapped getter (§1c).
4. `@selvajs/ui`: `getLastResult` on the `onReady` api.

Untouched by design: `websocket-solve-driver.ts` and `usePreviewState` need no code change —
only the documented absence from step 1.
