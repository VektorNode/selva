---
'@selvajs/ui': minor
---

Deepen the compute/footer/visibility internals for testability and locality.

**New — Solve Session.** `createSolveSession` + a transport-agnostic `SolveDriver` seam
(with `createRequestResponseDriver`) extract the value/lifecycle state machine out of
`ComputeApp` into `lib/compute/`. Pure transition logic lives in `solve-session-core.ts`
(unit-tested); the reactive wrapper is a thin shell. `SolveResult` is now exported from
the public surface. See `packages/ui/CONTEXT.md` for the vocabulary.

**New — `buildVisibilityMap` / `itemKey`** in `lib/schema/visibility-rules`: evaluate
each layout item's visibility once per render instead of repeatedly across `Group` and
`TabLayout`.

**Tests.** Added coverage for `createComputeThrottle` (latest-wins, abort-on-retrigger,
timeout, cancel) — the vitest config now loads the Svelte plugin so `.svelte.ts` rune
modules run in tests.

**⚠️ Footer registration API changed (potentially breaking).** `useFooterItem` and
`FooterStore.register` now take a single typed options object instead of positional
arguments, and `FooterItem` is generic over its component's props (no more `any`).

Migrate call sites from:

```ts
useFooterItem('ws-status', WsStatusFooter, () => ({ connected }), 'left', 10);
```

to:

```ts
useFooterItem({
	id: 'ws-status',
	component: WsStatusFooter,
	getProps: () => ({ connected }),
	position: 'left',
	priority: 10
});
```

Released as a minor because the footer registration is used internally; bump to major
in your own release if an external consumer relies on the old positional signature.
