# A `SolveEngine` facade for `@selvajs/solve` — zero-config server/client bootstrap

**Status: proposal, not started.** Written from the Parafa side after a full audit of both apps'
compute-route wiring, 2026-08-02.

## The problem, measured

`@selvajs/solve` already extracted the right _primitives_ — `runSolvePipeline`,
`createClientCache`, `createDefinitionByteCache`, `createSolveCacheSingleFlight`,
`createSolveSession` / `createRequestResponseDriver` on the client side. But every consumer still
has to hand-assemble them into a working solve path, and we now have two independent assemblies
that prove the point: Selva's own `/api/compute` route and its `lib/server/compute/*.server.ts`
adapters, and Parafa's equivalent. They are not "similar in spirit" — they are **structurally
identical**, down to matching HTTP status codes and matching error message text, because Parafa's
files are literally adapted line-by-line from Selva's:

- `clientCache.server.ts`, `definitionByteCache.server.ts`, `solveCache.server.ts` — ~200 combined
  lines in each app, zero app-specific logic. Every line is "read an env-derived config value, feed
  it to a `create*` factory, re-export two or three methods."
- The coalesce-key + `AbortController`/`hasWaiters` dance in the route (Selva:
  `packages/selva/src/routes/api/compute/+server.ts:330-359`; Parafa:
  `src/lib/server/compute/solve.server.ts`, `solveDefinitionEnvelope`) — same shape, same reasoning
  in the comments, written twice.
- The `SolveOutcome → HTTP Response` switch. Compare Selva's
  `packages/selva/src/routes/api/compute/+server.ts:384-421` against Parafa's
  `src/routes/api/compute/+server.ts:87-114`: same five cases (`timeout`→504, `client_abort`→499,
  `too_large`→413, `shed`→503+`Retry-After` with the _same_ JSON shape, `compute_error` rethrown),
  same message copy for the 413 case word-for-word.

Two teams (well, one person, wearing two hats) independently arrived at the same ~150-200 lines of
glue per app. That is the signal that this glue belongs in the package, not in each app. Every
future platform adopting `@selvajs/solve` will write it a third time unless the package absorbs it.

## Design goal: a new platform should be solving within minutes, with almost no config

Concretely: **the only thing a new consumer should have to provide to get a working interactive
solve endpoint is where the Rhino.Compute server is** (`serverUrl`, optionally `apiKey`). Everything
else — concurrency, queueing, caching, byte budgets, rate-limit window — already has a sane default
in `resolveComputeLimits` (verified: every one of its 19 knobs falls back to a shipped default; none
is required — see `packages/server/src/compute/limits.ts:277-330`). The gap isn't config, it's code:
today a consumer must _know_ to construct three separate caches, wire a single-flight coalescer
around the pipeline call, and hand-write a five-case HTTP mapping before any of those good defaults
even matter. The facade's job is to make that knowledge unnecessary for the common path, while
staying fully overridable for a platform (like Parafa) that needs to deviate.

## Proposed addition: `SolveEngine` in `@selvajs/solve/server`

A single class that owns everything currently split across `clientCache.server.ts` +
`definitionByteCache.server.ts` + `solveCache.server.ts` + the coalesce/abort logic + the outcome
mapping.

```ts
import { SolveEngine } from '@selvajs/solve/server';

// The ONLY required input. Everything else has a shipped default.
const engine = new SolveEngine({
	// Optional — defaults applied via resolveComputeLimits(process.env) if omitted.
	// A consumer that already resolves its own env (SvelteKit's $env/dynamic/private,
	// a framework with a different env story, tests) passes a ComputeLimits object instead.
	limits: myResolvedComputeLimits // optional
});
```

### `engine.solve(...)` — replaces the hand-written coalesce + pipeline call

```ts
const outcome = await engine.solve({
	server: resolvedServerConfig, // { id, serverUrl, apiKey? } — the one mandatory per-call input
	definitionSource, // raw bytes, a DefinitionRef, or a (versionId, load) pair — see below
	inputs,
	values,
	signal, // the request's AbortSignal; engine owns the hasWaiters/non-aborting-signal dance internally
	acceptEncoding // optional, for gzip negotiation
});
```

Internally: builds (or reuses) the warm client from its own `ClientCache`, resolves
`definitionSource` through its own `DefinitionByteCache` when given a `(versionId, load)` pair
(consumer never touches `ByteCacheRef`/`byteRefOutcome` directly — the engine threads that through),
derives the coalesce key from `(server.id, definitionSource key, stableStringify(transformedInputTree))`
— keyed on the transformed tree rather than raw `{inputs, values}`, deliberately, so requests that
differ only in normalizable ways still coalesce (mirrors the route's existing comment on this),
and runs the whole thing through its internal single-flight coalescer with the exact abort semantics
Selva's route already implements by hand. Returns the same `SolveOutcome` consumers already know —
**this does not change the pipeline's output contract**, only who assembles the call.

### `engine.toResponse(outcome, opts?)` — replaces the hand-written status-code switch

```ts
return engine.toResponse(outcome);
// or, for a framework that wants its own error type instead of a raw Response:
return engine.toResponse(outcome, { onError: (status, body) => myFrameworkError(status, body) });
```

Owns the five-case mapping (504/499/413/503+`Retry-After`/rethrow) with today's already-shared
message copy as the default. `opts.onError` is the escape hatch for a consumer whose error
convention isn't "return a `Response`" (SvelteKit's `error()` helper, for instance) — it receives
`(status, {message, retryAfter?})` and can wrap it however the host framework expects. A consumer
that wants genuinely custom status mapping still has `outcome.kind` available and can skip
`toResponse` entirely; nothing about `engine.solve()` requires using it.

### Definition-byte-cache ergonomics folded in

Right now a consumer has to know the byte-cache exists, build a `DefinitionRef` by hand
(`definitionRef(versionId, load)`), thread its mutable `.outcome` into `byteRefOutcome`, and only
_then_ pass the ref as `definitionSource`. That's real API surface a newcomer has to discover before
their first solve gets the "don't re-upload the .gh on every request" win. Proposal: `engine.solve`
accepts a `{ versionId, load }` shape directly for `definitionSource` and does the ref-building +
outcome-threading itself — the explicit `DefinitionRef`/`byteRefOutcome` primitives stay exported
for a consumer that wants manual control (Parafa's schema-backfill bridge, e.g., needs the raw ref
to call `.load()` itself before the solve), but nobody has to know they exist for the default path.

### Observability stays available, opt-in

`engine.stats()` returns `{ client: ClientCacheStats, definitionBytes: ByteCacheStats,
solveCacheStats-equivalent }` — today spread across three separate `*Stats()` functions a consumer
has to know to call individually (`solveCacheStats` from `clientCache.server.ts`,
`definitionByteCacheStats` from `definitionByteCache.server.ts` — `solveCache.server.ts` no longer
owns a stats function, it only wraps `createSolveCacheSingleFlight`). One call replaces three
imports for an admin/debug page.

## Proposed addition: a `SolveFn` factory in `@selvajs/solve/client` (or `@selvajs/ui`)

The client-side gap is smaller — `ComputeApp` already owns session/driver/throttle/memo — but the
`onSolve: SolveFn` implementation itself is where the two apps re-converge. Compare Selva's
`packages/selva/src/routes/library/[guid]/+page.svelte` (fetch + 401/redirect/non-JSON-200 handling

- 429 cooldown + rhino3dm lazy-load + mesh extraction) against Parafa's `onSolve` in
  `src/routes/app/solve/[guid]/+page.svelte:384-428` — same fetch, same shape, missing several of
  Selva's resilience cases only because nobody ported them (see the follow-up note below).

Proposed:

```ts
import { createComputeFetchSolveFn } from '@selvajs/solve/client';

const onSolve = createComputeFetchSolveFn({
	endpoint: '/api/compute', // the only required option
	definitionUrl: () => data.ghDefinition,
	// Everything below is optional, with the behavior Selva's page already has as the default:
	channel: () => (data.channel === 'draft' ? 'draft' : undefined),
	rhino: 'lazy', // default: lazy-loads rhino3dm on first solve that needs it, cached after.
	//                Pass a resolved RhinoModule to reuse one the host already loaded, or
	//                `null` to skip curve/point display items entirely (meshes still work).
	onRateLimited: (retryAfterSeconds) => {
		/* default: throws a cooldown-aware Error like Selva's page does */
	},
	onSessionExpired: () => {
		/* default: throws an actionable "reload to sign in again" Error */
	}
});
```

This one function call would have caught the exact gap the Parafa audit found: Parafa's `onSolve`
never passes `rhino` to `getThreeMeshesFromComputeResponse`, so any definition with GH `Display`
curves/points silently renders nothing for them — a bug that exists purely because the resilience
logic lives in app code that has to be independently rediscovered per platform, not because anyone
made a deliberate tradeoff.

## What stays out of the facade — deliberately

- **`resolveServerForOrg` / server selection.** Parafa's env-first shortcut
  (`src/lib/server/compute/resolve.server.ts`) vs. Selva's DB-only resolution is a genuine product
  decision, not duplication — `SolveEngine.solve()` takes an already-resolved `server` per call for
  exactly this reason. The facade should never decide _which_ Compute server to use.
- **Auth, DB reads for the definition/version record, share tokens, per-caller rate limiting, the
  metric sink.** These are app policy by definition (literally — see the doc comment at the top of
  both routes: "nothing here touches auth, the database, share tokens, rate limits or metric sinks").
  The facade's `solve()` takes a resolved `definitionSource` and `server`; it never reaches into a
  data provider itself.
- **`transformInputParameter` / `buildSolveInputTree`.** Already correctly internal to
  `runSolvePipeline` — no consumer should be calling these directly today, and the facade changes
  nothing here.

## No back-compat constraint

`@selvajs/solve` has exactly two consumers today — Selva itself and Parafa — both controlled by the
same person, and Parafa updates by pulling the package like any other customer would via the CLI.
There is no third-party consumer to protect and no dual-export period to design. `createClientCache`,
`createDefinitionByteCache`, `createSolveCacheSingleFlight`, and the standalone coalescer stay
exported as the manual-control primitives (Parafa's schema-backfill bridge needs `DefinitionRef`
directly — see above), but `SolveEngine` is not a compatibility wrapper around them and owes nothing
to a prior version of its own API. Breaking `SolveEngine`'s shape pre-1.0 is fine; the cost is a
`grep` across two repos, not a deprecation cycle. The design bar this raises is the opposite of
compat: no fallback paths, no config knobs kept "just in case," no half-adopted state where a route
calls both the old primitives and the new facade at once — ship the facade, migrate the call site in
the same change, delete the old file. Anything that looks like dead code on arrival (an unused
`opts.legacy` flag, an export nothing calls) is a sign the API surface is wrong, not a sign it needs
more flexibility.

## Migration shape (once built)

1. Selva's own `packages/selva/src/lib/server/compute/{clientCache,definitionByteCache,solveCache}.server.ts`
   and the route's coalesce/mapping code become a ~20-line adapter around `SolveEngine` — this is the
   dogfooding step that proves the API before anyone else adopts it. The three old files are deleted
   in the same change, not kept alongside the new adapter.
2. Selva's `library/[guid]/+page.svelte` `onSolve` becomes a call to `createComputeFetchSolveFn(...)`
   with its existing behavior as the defaults — no behavior change, less code.
3. Parafa adopts both on its own schedule, deleting its equivalent hand-rolled files
   (`clientCache.server.ts`/`definitionByteCache.server.ts`/`solveCache.server.ts` collapse into one
   `SolveEngine` instance; `onSolve` shrinks to a `createComputeFetchSolveFn` call). This also
   retroactively fixes the missing-`rhino`-param bug and picks up rate-limit cooldown +
   session-expiry handling for free, without Parafa having to port them by hand.
4. Any _future_ platform starts here directly — construct `SolveEngine` with just a server URL,
   `createComputeFetchSolveFn` pointed at its own `/api/compute`-equivalent, done.

## Decisions (no external consumers to protect, so these are settled, not open)

- **One Compute server per engine, no pooling.** Today both apps resolve to ONE server per solve and
  hand it in. `SolveEngine` stays single-server-per-instance; a multi-server platform constructs and
  caches multiple `SolveEngine`s keyed however it likes, mirroring how `ClientCache` already keys on
  `server.id` internally. Pooling inside the engine would be speculative generality with zero current
  caller — add it if and when a real multi-server consumer shows up, not before.
- **`engine.toResponse()` returns a framework-agnostic `{status, headers, body}` object**, not a
  SvelteKit `Response`, with a `toWebResponse()` helper for the SvelteKit call sites (both current
  consumers). `@selvajs/solve/server` has zero framework dependency today; a `Response`-typed return
  would be the first one, for no benefit to either current consumer.
- **`createComputeFetchSolveFn` lives in `@selvajs/solve/client`**, not `@selvajs/ui` — matches where
  `createRequestResponseDriver` already lives, and keeps `@selvajs/ui`'s `ComputeApp` delegating to
  solve/client for fetch-shaped solving rather than owning that logic itself, consistent with how it
  works today.
