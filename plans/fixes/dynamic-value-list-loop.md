# [Fix]: Dynamic value list — kill the feedback-loop class, centralize reconciliation, prove it end to end

**Status:** open · **Labels:** `correctness`, `solve-path` · **Scope:** `@selvajs/solve`, `@selvajs/ui`, `@selvajs/plugin-ui`, `Plugin/Selva.GH`, compute.rhino3d fork
**Origin:** full four-repo trace 2026-07-31 (GH plugin → wire → solve package → UI reactivity → compute.geometry). File refs below are from that trace.

## The problem in one paragraph

The DVL protocol carries no identity: the payload is `{ targetInputId, options }` — no `selected`,
no revision, no hash ([DynamicValueListPayload.cs:40-58](../../Plugin/Selva.GH/Features/ComputeIO/Goos/DynamicValueListPayload.cs)).
The plugin re-emits it on **every** solve with no change detection, and input-side dedup is
deliberately disabled for DVL ([ValueApplicator.cs:94-106](../../Plugin/Selva.GH/Features/UIBuilder/Services/ValueApplicator.cs)).
Because nothing upstream says "same options" vs "new options" or "here is the resolved selection",
every downstream layer compensates with a local heuristic:

| Layer                                       | Compensation                                                               | Failure mode                                                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InputControl.svelte:132-165`               | `$effect` reconciler: validity check + per-instance budget of 3 auto-picks | Effect writes what it reads; budget is per component instance (resets on remount, two mutually-dependent DVLs are unbounded); on trip it silently desyncs — only signal is `console.warn` |
| `dynamic-value-list.ts:43-82`               | LRU-8 string-payload memo (only ≥1024 chars)                               | Console-log canary instead of a guarantee; object payloads unguarded by design accident                                                                                                   |
| `solve-session-core.ts:84-94`               | `pickInputValues` echo suppression                                         | Correct, but exists only because outputs share the inputs map                                                                                                                             |
| compute fork `GrasshopperDefinition.cs:343` | `AlreadySet` raw-string dedup                                              | **Wrong direction**: unchanged selection string + changed options → `SetValues` skipped, stale resolution — the exact bug the plugin's dedup-disable fixed, reintroduced                  |

The solve package itself has **zero** loop protection — any host other than the `ui` preview layer
inherits none of the above.

Separately, `targetInputId` has two sources of truth with **opposite precedence**: runtime lets
`schema.outputs[]` win (`dynamic-value-list.ts:109-112`), the validator lets layout win
(`plugin-ui/src/lib/utils/validation.ts:228`), and the builder picker edits only layout config
(`BuilderGroupItem.svelte:480`). Editing the target in the builder can pass validation and still
route to the stale target at runtime.

## Design

Two moves, everything else follows:

1. **Reconciliation moves from `InputControl.svelte` into the session** (`@selvajs/solve/client`),
   as a host-injected hook so the solve package stays type-blind (its deliberate design — DVL
   semantics stay in `@selvajs/ui`). The session owns one **global** convergence budget, a
   content-equality gate, and a surfaced `stalled` status.
2. **The E2E contract is proven by tests at three levels**: pure unit (convergence math),
   deterministic Playwright against the WS stub (real reactive chain, scripted oscillation), and a
   real Grasshopper fixture for live/compute-path verification (user-supplied `.gh`, spec below).

Explicitly **not** doing: adding a `selected`/revision field to the wire payload. With the session
gate comparing options content and owning the selection, the client no longer needs the server to
version the payload — and the Set-DynVL component can't know the resolved selection anyway (the Get
param resolves at emit time, upstream of it, against the _previous_ options). Revisit only if the
content-equality gate proves too expensive in practice (the coerce memo says it won't).

## Phases

### Phase 0 — extract the selection logic pure

Pull the reconciliation decision out of `InputControl.svelte:112-165` into a pure function in
`packages/ui/src/lib/schema/dynamic-value-list.ts` (it currently holds only the payload→options
projection):

```ts
reconcileSelection(current: unknown, options: Record<string, string>):
  { action: 'keep' } | { action: 'set'; value: string | string[] }
```

Semantics preserved exactly (they are correct, just mislocated): valid → keep; checklist partially
valid → prune to survivors; stale/empty → first option (insertion order); never resolves to
empty — the NRE invariant from `InputControl.svelte:118-122` moves here as the function's contract.
Unit-test the matrix (single/multi, empty options, reordered-same-membership → keep).

No behavior change; `InputControl`'s effect calls the pure function. Ship independently.

### Phase 1 — session-level reconciler hook (the core fix)

In `@selvajs/solve/client`:

- `createSolveSession` accepts an optional `reconcile?: (values, schema) => Record<string, unknown>`
  (returns the value-changes to apply, empty object = converged). Called in `report()` after
  `applySolveResult`, **before** `emit()`.
- Session-owned convergence state, global across all inputs:
  - `MAX_CONSECUTIVE_SYSTEM_SOLVES` (keep 3) counted per _dispatch_, not per input — two
    mutually-invalidating DVLs share one budget.
  - Reset on any user-initiated `setValue`; **not** reset by a system pick re-validating another
    input (the per-instance counter's unboundedness hole).
  - **Content gate:** before re-dispatching, compare each changed input's driving options object
    against the previous solve's (the coerced payload is already memoized/reference-stable —
    `dynamic-value-list.ts:50`). Options unchanged + selection unchanged → apply nothing, no
    dispatch. This is what turns "plugin re-emits every solve" from a loop hazard into a no-op.
  - On budget trip: set a session status field (e.g. `reconciliation: { stalled: string[] }`)
    surfaced through the existing subscribe/version-counter bridge — UI renders a warning on the
    affected control instead of today's console-only `warn`.
- `@selvajs/ui` wires it: `useSolveSession` / `usePreviewState` pass a reconciler built from
  `buildDynamicValueListOptions` + Phase 0's `reconcileSelection`.
- **Delete the `$effect` from `InputControl.svelte`** (and `autoPickCount`). The control becomes
  render + commit only. `forceSolve` on `setValue` stays (manual-mode override,
  `solve-session.ts:103-114`) but its only remaining caller is the session itself.

Tests (framework-free, in `packages/solve/src/client/__tests__/`): convergent case settles in one
pass; oscillating reconciler trips the budget at 3 and sets `stalled`; user `setValue` re-arms;
unchanged options produce zero extra dispatches across N solves; manual mode still defers user
changes but reconciliation force-solves.

### Phase 2 — `targetInputId` single source of truth

Canonical: `schema.outputs[].targetInputId` (matches runtime precedence and the plugin
canonicalizer's direction — `SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs` already
mirrors layout → outputs).

- Builder picker write-through: when `BuilderGroupItem` edits the layout config, `operations.ts`
  also updates the matching `schema.outputs[]` entry immediately (don't wait for a plugin
  round-trip).
- Align the validator (`validation.ts:228`) to outputs-wins.
- Keep the layout config as authoring input only; runtime dedup already prefers outputs
  (pinned by test).

### Phase 3 — compute fork: exempt ValueList from `AlreadySet`

In `compute.rhino3d/src/compute.geometry/GrasshopperDefinition.cs`: skip the
`inputGroup.AlreadySet(tree)` short-circuit for `ParamTypeName == "ValueList"` (mirror of the
plugin's `skipDedup` — same rationale comment, same string can resolve differently against
recomputed options). One fork commit, no lockstep needed (behavioral fix, no wire change).

Out of scope but recorded: the immortal definition cache for base64-uploaded definitions
(`IsLocalFileDefinition` never set → never invalidated, `DataCache.cs:277-283`) and `resultsCache`
serving stale options byte-identical. Both are real staleness vectors; both are general
compute-cache problems, not DVL-specific. File separately against the fork.

### Phase 4 — adjacent unguarded effects (small, independent)

- [TabLayout.svelte:61-79](../../packages/ui/src/lib/components/preview/TabLayout.svelte):
  visibility-defaults effect writes `values` directly, bypassing the session
  (`pendingValues`/`hasPendingChanges` never learn of it) and its `!==` brake never converges for
  non-primitive defaults. Route through the session's value-change path; guard primitives-only.
- [TabLayout.svelte:40-46](../../packages/ui/src/lib/components/preview/TabLayout.svelte):
  activeTabId effect — verify the truthiness guard suffices once the above is fixed.
- `InputControl.svelte:49` drop the pointless `$bindable`.

### Phase 5 — end-to-end tests

**Level 1 — Playwright against the WS stub** (extends the existing `plugin-ui` E2E harness — real
`GrasshopperSource`, scripted server). Add stub behaviors that recompute the DVL outputs envelope
as a function of the received `valueUpdate`:

1. **Steady:** options independent of selection. Assert: initial auto-pick happens once, exactly
   one solve per user pick, and N consecutive identical outputs envelopes cause **zero** extra
   solves (the content gate, observable as stub-side solve count).
2. **Convergent dependency:** slider N drives options `1..N`. Shrink N below the current
   selection → assert exactly one system re-solve, selection lands on a valid option, then quiet.
3. **Oscillating:** stub excludes the currently-selected value from the next options. Assert: at
   most 3 system solves, then the `stalled` warning is visible in the UI and **no further solves
   occur** (poll the stub's request count over a settle window).
4. **Checklist prune:** multi-select with one surviving value → pruned, one solve, not reset to
   first.

**Level 2 — real Grasshopper fixture** (user-supplied `.gh`, lives with the other fixtures — spec
below). Two consumption modes:

- **Live (local WS mode):** manual checklist in this file — open fixture in Rhino, connect
  plugin-ui dev server, walk scenarios 1–3, confirm no solve storm in the GH profiler.
- **Compute mode (gated automated):** a vitest in `packages/solve` gated on
  `SELVA_E2E_COMPUTE_URL` that POSTs the fixture through the real solve pipeline
  (`transform-input` → compute fork → payload back) and asserts: `dynamicValueList` payload
  round-trips the golden shape; sending the _same_ selection twice with a _changed_ options-driving
  input returns updated resolution (this is the Phase 3 regression test — it fails on today's
  `AlreadySet`).

### Fixture spec (for the `.gh` you'll build)

One definition, three groups, so a single fixture covers all scenarios:

- **Inputs:** `GetDynamicValueParameter` nicknamed `dvlSelect` (item access); a slider `count`
  (RH_IN or contextual, range 1–5, default 3).
- **Steady group:** a Panel-style static pair list `"A" = 1, "B" = 2, "C" = 3` → `Set Dynamic
Value List` (target = `dvlSelect`) → ContextBake.
- **Convergent group (switchable):** options generated from `count` (e.g. Series → `"Item {i}" = i`
  pairs) → same Set/Bake wiring. Include both groups but wire only one at a time — or use a second
  Get/Set pair `dvlConvergent` so both are live simultaneously (preferred: also exercises the
  multi-DVL global budget).
- **Oscillation trigger:** a variant where the pair list is built as _all items minus the currently
  selected one_ (cull by equality with `dvlSelect`'s output). This is the loop case — keep it in a
  disabled group with a note, enable only for the oscillation scenario.
- **Downstream consumer:** wire `dvlSelect` into something that NREs on null (e.g. Bounding
  Rectangle chain, per the invariant comment) so the "never dispatch empty" contract is actually
  load-bearing in the fixture.
- Save with a selection applied, so `StoredItems`/`SelectedValues` archive round-trip
  (`GetDynamicValueListParameter.cs:355-380`) is exercised on load.

## Order & risk

0 → 1 are the substance and land together behaviorally (0 is refactor-only). 2, 3, 4 are
independent of each other and of 1. 5 (Level 1) should land **with** Phase 1 — the Playwright
scenarios are the acceptance tests for the session reconciler. Level 2 compute test lands with
Phase 3.

Risk concentrates in Phase 1's interaction with manual solve mode and the throttle
(`async-throttle` latest-wins + the `finally` drain — a reconcile dispatch racing a user pick).
The session tests must cover: reconcile fires while a user solve is in flight (latest-wins should
supersede the reconcile, and the user pick resets the budget).
