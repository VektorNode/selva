# [Fix]: Dynamic value list — kill the feedback-loop class, centralize reconciliation, prove it end to end

**Status:** open · **Labels:** `correctness`, `solve-path` · **Scope:** `@selvajs/solve`, `@selvajs/ui`, `@selvajs/plugin-ui`, `Plugin/Selva.GH`, compute.rhino3d fork
**Origin:** full four-repo trace 2026-07-31 (GH plugin → wire → solve package → UI reactivity → compute.geometry). File refs below are from that trace.
**Progress:** Phase 5 Level 2 fixture repaired and walked live 2026-08-03 (scenarios 1–3, real WS). Phases 0–4 not started.
**Validation:** all claims re-verified against the four repos 2026-08-03; corrections folded in below.
**Model correction:** the oscillating case stalls silently on an invalid value rather than
storming — the auto-pick budget never engages. See "Live walk" below; it changes what Phase 1's
content gate must read and what Phase 5 scenario 3 must assert.

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
| `dynamic-value-list.ts:43-82`               | LRU-8 string-payload memo (only ≥1024 chars)                               | `console.info` diagnostic (>256 KB payloads only) instead of a guarantee; object payloads unguarded by design accident                                                                    |
| `solve-session-core.ts:100-115`             | `pickInputValues` echo suppression                                         | Correct, but exists only because outputs share the inputs map; with no `schema.inputs` it returns the map unfiltered — suppression silently gone                                          |
| compute fork `GrasshopperDefinition.cs:343` | `AlreadySet` raw-string dedup                                              | **Wrong direction**: unchanged selection string + changed options → `SetValues` skipped, stale resolution — the exact bug the plugin's dedup-disable fixed, reintroduced                  |

The solve package itself has **zero** loop protection — any host other than the `ui` preview layer
inherits none of the above.

Separately, `targetInputId` has two sources of truth with **opposite precedence**: runtime lets
`schema.outputs[]` win (`dynamic-value-list.ts:109-112`), the validator lets layout win
(`plugin-ui/src/lib/utils/validation.ts:228`), and the builder picker edits only layout config
(`BuilderGroupItem.svelte:480`). Editing the target in the builder can pass validation and still
route to the stale target at runtime.

## Live walk 2026-08-03 — the loop does not loop

Scenarios 1–3 were walked against the repaired fixture in Rhino with the plugin-ui dev server
attached (real WebSocket, not the stub). **The oscillating case does not produce a solve storm. It
produces a silent stall on an invalid value after a single round**, and the mechanism is not the
one this plan assumes.

| Scenario   | Result                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Steady     | Pick `C` → output `2`→`3`. One solve, no cross-talk to the other two DVLs.                        |
| Convergent | `count` 3→1 → options collapse to `[Item 1]`, output auto-picks `1`, then quiet (0 solves / 4 s). |
| Oscillate  | Pick `Y` → Set emits `[X, Z]`, output **stays `Y`** — not in its own option set. 0 solves / 8 s.  |

**Why it stalls instead of looping.** `_storedItems` on the Get param is never refreshed by a
solve — after the oscillate round it still held the full `X, Y, Z` from file load, and
`_selectedValues` was `NULL` (wiped by `ClearAllContextualParameters` at every solve-end). The
client validates the current selection against that stale list, `Y` still looks valid, so **no
re-pick is ever attempted and nothing is ever counted against the auto-pick budget**. The stale
cache masks the invalidity rather than triggering the compensation.

Consequences for the design below:

- **The convergence budget guards a loop this fixture cannot produce.** A session-level
  `MAX_CONSECUTIVE_SYSTEM_SOLVES` with a surfaced `stalled` status would not have fired in the
  oscillate case — there is no conflict to detect. Keep the budget as a backstop, but it is not
  what fixes the observed defect.
- **The content gate must compare against the emitted options, not the param's stored items.**
  This is the substantive correction to Phase 1: reconciliation has to read the options carried in
  the `dynamicValueList` payload of the current solve, because `_storedItems` is not a live view of
  them and the plugin never invalidates it.
- **Correctness in the convergent case is the UI's doing, not the plugin's.** `dvlConvergent` also
  kept stale 3-item `_storedItems`; the right answer arrived only because the client pushed a new
  value down. Strip the web UI — compute mode, CLI, MCP — and the same case emits a value outside
  the option set, which is the GH-only reproduction recorded under "Fixture".

**Precondition — this was unobservable before 2026-08-03.** The fixture's three DVL inputs were
typed `paramType: "ValueList"` (PascalCase, and the wrong type besides), so
`ValueApplicator.cs:102`'s `skipDedup` for `dynamicValueList` never fired and the DVL path was
never taken. Any earlier "verified live" claim about this fixture predates the path being
exercised at all. See [PLUGIN-CONTEXT.md](../../PLUGIN-CONTEXT.md) for the four wiring/identity
rules the fixture violated and now satisfies.

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
content-equality gate proves too expensive in practice. If it ever is revisited:
`DynamicValueListPayload` serializes through three paths (`ToJObject`, `ToCollectorPayload`,
`FromJson`) shared by the local WS collector and the compute fork — all three must change together,
pinned by a golden fixture both stacks load (the existing cross-stack contract pattern).

Consequence of no wire identity, written down so it isn't rediscovered: **every future host of
`@selvajs/solve` must wire a reconciler or it inherits zero loop protection.** Mitigations in
Phase 1: the budget/gate live in the session (package-owned), and `@selvajs/ui` exports the wired
DVL reconciler as one named factory so hosts import it rather than hand-roll it.

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

The empty guard is defense in depth, not the only one — the GH param already refuses an empty
selection (see "Fixture — as built"). Cover it with a unit test here; don't expect the fixture to
prove it.

No behavior change; `InputControl`'s effect calls the pure function. Ship independently.

### Phase 1 — session-level reconciler hook (the core fix)

In `@selvajs/solve/client`:

- `createSolveSession` accepts an optional reconciler. **Evolvable signature** — `@selvajs/solve`
  is published semver, so a single context object in and a structured result out, not positional
  args: `reconcile?: (ctx: { values, schema }) => { changes: Record<string, unknown> }` (empty
  `changes` = converged; fields can be added to either side without a major bump). Called in
  `report()` after `applySolveResult` (`solve-session.ts:166`), **before** `emit()` (`:167`) — the
  seam exists today with nothing between the two calls.
- `setValue` grows an explicit **origin** (`user` | `system`). `forceSolve` is not a proxy for it:
  Phase 4 routes TabLayout's visibility defaults through the session as system-initiated calls
  that must **not** re-arm the budget, and the reconciler's own picks are system too.
- Session-owned convergence state, global across all inputs:
  - `MAX_CONSECUTIVE_SYSTEM_SOLVES` (keep 3) counted per _dispatch_, not per input — two
    mutually-invalidating DVLs share one budget.
  - Reset on `origin: 'user'` `setValue` only; **not** by any system pick (the per-instance
    counter's unboundedness hole). The `stalled` status clears on the same user action.
  - **Source of options — settled by the 2026-08-03 live walk.** Read the options from the
    `dynamicValueList` payload of the **current solve**, never from the Get param's stored items.
    `_storedItems` is only repopulated by `LoadItems()` and is not a live view of what the Set
    component emitted; validating against it is what let the oscillate case stall on a value
    outside its own option set with the budget untouched. This applies to both the validity check
    inherited from Phase 0 and the content gate below.
  - **Content gate:** before re-dispatching, compare each changed input's driving options against
    the previous solve's. Reference equality only holds for string payloads ≥1024 chars (the
    coerce memo, `dynamic-value-list.ts:50-62`) — object payloads and small strings re-coerce
    fresh every call, so the gate must be **content** equality: raw-payload-string comparison
    where the payload arrived as a string (cheap even at the measured 6.4 MB), deep compare as the
    object fallback. Options unchanged + selection unchanged → apply nothing, no dispatch. This is
    what turns "plugin re-emits every solve" from a loop hazard into a no-op — and it is a
    performance requirement, not an implementation detail.
  - **Stale-report guard:** `state.values` mutates synchronously on user picks while a solve is in
    flight, and the older solve's `report()` then `Object.assign`s outputs over the re-picked map
    (`solve-session-core.ts:124`) — so the reconciler can run on mixed state. Tag dispatches with
    a generation counter and skip reconciliation for reports from superseded dispatches; at
    minimum, never emit a reconcile change for an input present in `pendingValues`.
  - On budget trip: set a session status field (e.g. `reconciliation: { stalled: string[] }`) —
    UI renders a warning on the affected control instead of today's console-only `warn`. The
    subscribe bridge does **not** auto-enumerate fields: the new state needs a getter in
    `@selvajs/solve`, a mirrored `$state` in `useSolveSession` (`packages/ui`), and a third mirror
    in `preview-state-core`/`usePreviewState` (`packages/plugin-ui`). Three places; list them in
    the PR checklist.
- Host wiring — two hosts, two packages: `useSolveSession` in `packages/ui` and
  `usePreviewState`/`preview-state-core` in `packages/plugin-ui` both pass a reconciler built from
  `buildDynamicValueListOptions` + Phase 0's `reconcileSelection`. Export that composition from
  `@selvajs/ui` as one named factory (e.g. `createDynamicValueListReconciler`) and document the
  hook contract in the solve package README — future hosts wire one import.
- **Delete the `$effect` from `InputControl.svelte`** (and `autoPickCount`). The control becomes
  render + commit only. `forceSolve` on `setValue` stays (manual-mode override,
  `solve-session.ts:115-126`) but its only remaining caller is the session itself. Once the
  `stalled` status ships, also drop the `console.warn`/`console.info` canaries in `ui` — left in
  place they linger as the de-facto interface.

Tests (Vitest, alongside the existing suite in `packages/solve/src/client/__tests__/` — the
runtime stays UI-framework-free, the tests are not): convergent case settles in one pass;
oscillating reconciler trips the budget at 3 and sets `stalled`; user `setValue` re-arms and
clears `stalled`; unchanged options produce zero extra dispatches across N solves; manual mode
still defers user changes but reconciliation force-solves; a system-origin `setValue` does not
reset the budget; a stale report from a superseded dispatch drives no reconciliation.

### Phase 2 — `targetInputId` single source of truth

Canonical: `schema.outputs[].targetInputId` (matches runtime precedence and the plugin
canonicalizer's direction — `SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs` already
mirrors layout → outputs).

- Builder picker write-through: when `BuilderGroupItem` edits the layout config, `operations.ts`
  also updates the matching `schema.outputs[]` entry immediately (don't wait for a plugin
  round-trip).
- **The canonicalizer is add-only and that's a hole write-through alone doesn't close**:
  `CanonicalizeDynamicValueListOutputs` skips existing ids
  (`if (!existingIds.Add(dvl.ParamId)) continue;`) — it never _updates_ an existing outputs
  entry's `targetInputId` and never _removes_ entries whose layout item is gone. So (a) saved
  schemas whose outputs entry predates a retarget stay stale forever, and (b) deleting a DVL from
  the layout leaves an orphaned outputs entry the runtime still routes. Phase 2 needs
  update+prune semantics — retargets overwrite the existing entry, layout-item deletion removes
  it — in `operations.ts` and mirrored in the canonicalizer.
- Align the validator (`validation.ts:228`) to outputs-wins.
- Keep the layout config as authoring input only; runtime dedup already prefers outputs
  (pinned by test).

### Phase 3 — compute fork: exempt ValueList from `AlreadySet`

In `compute.rhino3d/src/compute.geometry/GrasshopperDefinition.cs`: skip the
`inputGroup.AlreadySet(tree)` short-circuit for ValueList params (mirror of the plugin's
`skipDedup` — same rationale comment, same string can resolve differently against recomputed
options). Placement matters: the exemption goes in `SetInputs` **before** the `AlreadySet` call at
line 343 (not inside `InputGroup.AlreadySet`), using the existing idiom
`ParamTypeName(inputGroup.Param) == "ValueList"` — the same string the `case "ValueList":` arm at
line 394 switches on. Caveat: that arm lives inside the contextual-parameter branch
(`IGH_ContextualParameter`); a raw non-contextual `GH_ValueList` input has no handler arm in the
fork at all, so the exemption only matters on the contextual path. `AlreadySet` compares
`SequenceEqual` over serialized `(Type, Data)` strings — raw string equality, as assumed. One fork
commit, no lockstep needed (behavioral fix, no wire change).

Out of scope but recorded: the immortal definition cache for base64-uploaded definitions
(`FromBase64String` never sets `IsLocalFileDefinition` — `GrasshopperDefinition.cs:109-127`;
invalidation is gated on that flag at `DataCache.cs:131-139`, and entries also persist to disk and
rehydrate on memory-cache miss, so eviction wouldn't help) and `resultsCache` serving stale
responses byte-identical, keyed on the raw request body. Both are real staleness vectors; both are
general compute-cache problems, not DVL-specific. File separately against the fork.

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
3. **Oscillating:** stub excludes the currently-selected value from the next options. Assert
   **first** that the selection is detected as invalid at all — against the emitted options, not a
   cached item list. That detection is the regression the live walk showed missing: today the case
   stalls silently on an out-of-set value with zero further solves, so a bare "no further solves"
   assertion passes on the broken behaviour. Then assert at most 3 system solves, the `stalled`
   warning visible in the UI, and no further solves over a settle window.
4. **Checklist prune:** multi-select with one surviving value → pruned, one solve, not reset to
   first.

**Level 2 — real Grasshopper fixture** — **built**, see "Fixture" below. Two consumption modes:

- **Live (local WS mode):** manual checklist in this file — open fixture in Rhino, connect
  plugin-ui dev server, walk scenarios 1–3. **"No solve storm" is not the pass condition** — the
  2026-08-03 walk showed all three scenarios quiet while scenario 3 was wrong. Check the emitted
  options against the Get param's output value; they must agree.
- **Compute mode (gated automated):** a vitest in `packages/solve` gated on
  `SELVA_E2E_COMPUTE_URL` that POSTs the fixture through the real solve pipeline
  (`transform-input` → compute fork → payload back) and asserts: `dynamicValueList` payload
  round-trips the golden shape; sending the _same_ selection twice with a _changed_ options-driving
  input returns updated resolution (this is the Phase 3 regression test — it fails on today's
  `AlreadySet`).

### Fixture — as built

[`fixtures/grasshopper/fixture_dynamic_value_list.ghx`](../../fixtures/grasshopper/fixture_dynamic_value_list.ghx),
recipe at [`recipes/fixture_dynamic_value_list.json`](../../fixtures/grasshopper/recipes/fixture_dynamic_value_list.json).
**22 objects, 4 Context Bakes**, 3 groups, 0 runtime errors; read back through Rhino MCP against a
live Grasshopper, verified surviving a close/reopen cycle.

**Repaired 2026-08-03.** As originally committed the fixture was 19 objects with a single Context
Bake and did not work: all three `Set DynVL` outputs shared one bake (only the first is ever
surfaced), `schema.outputs[]` was keyed on the Set-component GUIDs instead of the bakes, the three
DVL inputs were typed `paramType: "ValueList"`, and there was no `Schema`-nicknamed bake at all —
the plugin scaffolded one at load. The four rules those violate are in
[PLUGIN-CONTEXT.md](../../PLUGIN-CONTEXT.md); the walk above is the first run where the DVL path
executed.

Three Get/Set pairs live simultaneously, so the multi-DVL global budget is exercised:

- **steady** — static `"A"=1, "B"=2, "C"=3` → `Set DynVL(dvlSelect)`. Options never change.
- **convergent** — `count` slider (1–5, integer, default 3) → `Get Number` → C# emits `"Item {i}"=i`
  → `Set DynVL(dvlConvergent)`.
- **oscillate** — C# reads `dvlOscillate`'s own selection and emits every option _except_ it.
  **Locked (disabled)** in the committed fixture; unlock only for the stall test. Emission
  confirmed live: sel `X` → emits `Y,Z`; pick `Y` → emits `X,Z`. That emission does **not** drive
  repeated re-picks — see the live walk above.

**Each `Set DynVL` gets its own Context Bake**, plus a fourth carrying only the UI Bridge `Schema`
(input nicknamed `Schema` — the plugin refuses to serve the UI without it). A bake surfaces only
its first recognized goo, so the three-on-one topology the earlier draft described cannot work.
Saved with selections applied (`dvlSelect=2`, `dvlConvergent=Item 2`, `dvlOscillate=X`, 3 stored
items each), so the `StoredItems`/`SelectedValues` archive round-trip is exercised on load. Note
`_selectedValues` is wiped by `ClearAllContextualParameters` at every solve-end — re-apply the
selections immediately before writing the archive, with no solve in between, or they are lost.

The UI Bridge carries an **embedded schema** keyed on InstanceGuids: 4 inputs (3 `dynamicValueList`

- 1 `number`, camelCase), 3 `dynamicValueList` outputs keyed on the **bake** GUIDs, tabbed layout
  with Steady/Convergent/Oscillate groups. Each group now also carries an
  `OutputDynamicValueListLayoutItem` whose `paramId` is the bake and whose `config.targetInputId` is
  the Get param.

**This changes what the fixture pins for Phase 2.** The earlier draft set `targetInputId` only in
`schema.outputs[]` to pin outputs-wins — but that made the fixture unrepresentative:
`ApplyParameterAccessFromSchema` keys the write-back onto the live Set component off the **layout
item**, so with no layout item the write-back never runs and the Set components can only get their
target from the archive. The fixture now carries both, which is the real authoring shape. Phase 2's
premise about precedence should be re-checked against that. Re-placing a param changes its guid and
silently desyncs the schema; update both together.

**The reconciliation gap reproduces in Grasshopper alone, no UI attached.** Driving `count` 3 → 1
makes the convergent script emit only `"Item 1"`, while `dvlConvergent` keeps its stale 3-item
`_storedItems` and still outputs `2` — a value no longer in the emitted options. `_storedItems` is
only repopulated from the UI by `LoadItems()` (`EmitData` also seeds it from wired GH sources, and
`Read()` restores it on document open — but never from the Set component); the Set component never
pushes options back into the Get param on solve. This is the deterministic failing case for the
Level 2 test.

**Correction to Phase 0's contract.** The "never resolves to empty" invariant is already enforced
at the param, twice: `SelectItemsByName` returns `false` and no-ops on an empty list
([GetDynamicValueListParameter.cs:177-187](../../Plugin/Selva.GH/Features/ComputeIO/Components/GetDynamicValueListParameter.cs#L177-L187)),
and a null `_selectedValues` falls back to the first stored item. The param could not be forced
empty from a live document. So `reconcileSelection`'s empty guard is belt-and-braces over an
existing plugin guarantee, not the sole defense — and a downstream NRE consumer **cannot** make
that contract load-bearing in the fixture, contrary to the original spec. Test it with a double at
the session layer instead.

Rebuild caveat: the 8 C# script bodies are not reachable through the MCP script sandbox (they live
in each component's own `Script` chunk). A rebuild cannot restore them — hand-edit this fixture.

The committed `.ghx` currently carries uncommitted local modifications — commit or revert before
Level 2 relies on it.

## Order & risk

0 → 1 are the substance and land together behaviorally (0 is refactor-only). 2, 3, 4 are
independent of each other and of 1. 5 (Level 1) should land **with** Phase 1 — the Playwright
scenarios are the acceptance tests for the session reconciler. Level 2 compute test lands with
Phase 3.

Risk concentrates in Phase 1's interaction with manual solve mode and the throttle
(`async-throttle` latest-wins + the `finally` drain — a reconcile dispatch racing a user pick).
The session tests must cover: reconcile fires while a user solve is in flight (latest-wins should
supersede the reconcile, and the user pick resets the budget). The concrete hazard is now specced
as Phase 1's stale-report guard — the throttle keeps a single pending slot and drains it in
`finally`, while `state.values` mutates under the in-flight snapshot; without the generation
check, the older solve's report reconciles against mixed state.
