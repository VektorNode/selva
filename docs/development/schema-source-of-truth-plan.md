# Schema Source-of-Truth Refactor

**Status:** Implemented 2026-05-12 (single commit, Review-diff stubbed).
**Date:** 2026-05-12
**Scope:** Eliminate schema drift between Grasshopper (C#) and the builder UI by establishing a single canonical source with explicit save/discard semantics.

## What shipped vs. plan

**Done as specified:**

- C# `SchemaHash.Compute(UISchema)` — sorted-key JSON → SHA-256 hex. Lives at [Plugin/Selva.GH/Features/UIBuilder/Services/Schema/SchemaHash.cs](../../Plugin/Selva.GH/Features/UIBuilder/Services/Schema/SchemaHash.cs).
- `BroadcastInitialData` and `BroadcastSchemaUpdate` carry `schemaHash`. New `BroadcastSchemaSaveRejected(currentSchema, reason)` carries the fresh canonical + its hash.
- `OnSchemaSaveRequested` now passes a `SchemaSaveRequest { Schema, BaseSchemaHash }`. `BridgeOrchestrator.HandleSchemaSave` rejects on hash mismatch and replies with `schemaSaveRejected`.
- After a successful save, `BridgeOrchestrator` broadcasts `BroadcastSchemaUpdate(validatedSchema)` before the success ack so the UI rebases its draft on the post-save canonical.
- TS state shape replaced: `state.schema` → `canonical / draft / isDirty / canonicalHash / conflictPending / conflictReason / documentId`. All UI rendering reads from `draft`; broadcasts mutate `canonical`. Lives in [useBuilderState.svelte.ts](../../packages/builder-app/src/lib/composables/useBuilderState.svelte.ts).
- `useSchemaHistory` rewritten: undo/redo is **in-memory only**; LS holds only the draft, keyed by `documentId`; other-document drafts are purged on init. The old `LS_HISTORY_PREFIX` key family is gone.
- `useBuilderActions` mutations target `state.draft` and call `markDirty()`. Undo/redo paths in `+page.svelte` also call `markDirty()` and clear history on canonical replacement.
- `backfillDropdownOptions` deleted. Dropdown options ride along with the canonical → draft clone at load, and are patched into both canonical and (when clean) draft by `metadataUpdated`.
- `metadataUpdated` patches canonical always; patches draft only when `isDirty === false`; trips `conflictPending` when dirty.
- Builder route: explicit nav-prompt (Save / Discard / Cancel) on `→ /preview`, conflict banner with Discard / Save-anyway, draft-restore modal on load when LS has a draft for the current `documentId` that differs from the freshly-loaded canonical. Persistence effect now writes only when `isDirty`.
- `wsState.saveSchema(sessionId, schema, baseSchemaHash)` sends the base hash. New `WsSchemaSaveRejectedMessage` type.

**Deliberately stubbed/skipped per implementation decision:**

- **Coarse-diff Review UI** — the conflict banner has Discard + Save-anyway only; no diff view. Plan leaves this open and we opted to defer until the diff format settles in practice.
- **Preview `state.schema` rename** — kept as `state.schema` in `usePreviewState`. Preview has no draft, so the rename is purely cosmetic churn; not done.
- **Zod wire validation follow-up** — out of scope for this PR; see the plan's last section.

**Verified:** `pnpm check`, `pnpm type-check`, `pnpm lint` clean (no new warnings). `dotnet build` clean across net48 / net7.0 / net9.0.

---

## The problem

The schema currently lives in three places that can drift:

1. **`GH_Document` archive** — persisted in the `.gh` file via `GH_UIBuilderComponent.Write/Read`. Canonical on disk.
2. **`_embeddedSchema`** — in-memory copy on the C# component. Live working copy, mutated by `metadataUpdated` flows, save handlers, sync flows, and `MergePostSolveBakeOutputs`.
3. **localStorage** (`useSchemaHistory`) — browser-side cache. Today: holds the full schema, used as the *source* on UI reload (overrides whatever the server sends).

Last-writer-wins. The most reproducible symptom we hit:

1. User in **preview**, edits slider domain in GH → `metadataUpdated` broadcast → preview's in-memory state and server `_embeddedSchema` both update. Preview shows new range.
2. User navigates **preview → builder** → builder's `handleInitialData` checks `localStorage` first. localStorage has the **pre-edit** schema → builder shows old range.
3. User navigates **builder → preview** → navigation guard auto-saves the stale localStorage schema back to the server (`saveSchema` message). Server's `_embeddedSchema` is now stale.
4. Preview re-initializes → fetches stale `_embeddedSchema` → preview reverts.

This is the silent-data-loss class of bug. Three sources, no protocol for which wins.

---

## The design

### One sentence

**`_embeddedSchema` is canonical. The UI shows a *draft* layered on top. `localStorage` holds the draft, never the canonical. Saves are explicit. Broadcasts replace canonical wholesale.**

### Canonical vs. draft

- **`canonical`** in UI state = last schema received from the server. Read-only mirror. Replaced wholesale on every `initialData` and `schemaUpdated` broadcast.
- **`draft`** in UI state = the schema the user is editing. Always exists, initialized as `deepClone(canonical)` on load.
- **`isDirty`** boolean flag — flipped on first mutation of `draft`. Reset on successful save or on discard.
- All UI rendering reads from `draft`. Never from `canonical`.

### Persistence boundaries (acknowledging the .gh archive)

- **In-memory `_embeddedSchema`** is canonical for **live sync** (everything in this document).
- **`.gh` archive** is canonical for **cold start** — handled by GH's normal save/restore cycle (`Write`/`Read`). Out of scope for this plan; behaviour unchanged.

### Behaviour when broadcasts arrive

A single "any broadcast → banner if dirty" rule is too coarse. In practice, most GH-side changes are structural reconciliations the draft can absorb safely (params keyed by id, layout untouched). Only true conflicts — where canonical contradicts something the user has actively edited — warrant interruption.

When `draft` is **clean**, all broadcasts replace canonical and re-clone draft. (Same as today's UX.)

When `draft` is **dirty**, classify by message type:

| Broadcast | Action on dirty draft | Notes |
|---|---|---|
| `metadataUpdated` (range/options/nickname on existing paramIds) | **Silent merge.** Patch canonical AND apply the same patch to draft via `updateParameterMetadata`. | Same patching code path the UI already uses. Non-conflicting by construction: it touches fields keyed by paramId that the draft already references. |
| `schemaUpdated` with `removedIds` (param deleted in GH) | **Silent merge.** Filter dead paramIds out of canonical AND draft layout (existing helper from `handleSchemaUpdated`). | Stale paramIds in the draft render broken; leaving them would be worse than the banner. |
| `schemaUpdated` from `MergePostSolveBakeOutputs` add | **Silent merge.** Append to canonical.outputs and draft.outputs. Do not auto-place in layout. Toast: *"New output available from Grasshopper."* | Bake-output add/remove is forced reconciliation, not a user choice. |
| `schemaUpdated` from `MergePostSolveBakeOutputs` remove | **Silent merge.** Same as `removedIds` above. | |
| `parametersAdded` | **Silent merge** into canonical.availableInputs/outputs and draft.availableInputs/outputs. `syncNeeded = true` flips, today's "click Sync" prompt fires. | Matches today's behaviour. |
| `initialData` (typically reconnect / explicit refresh) | **Banner.** Replace canonical wholesale. Leave draft untouched. *"Grasshopper changed. [Review] [Discard my edits]"*. | The only wholesale-replacement broadcast. True ambiguity: we can't selectively merge into the draft because we don't know what changed. |
| `schemaSaveRejected` (save-conflict path) | **Banner.** Same Review/Discard UX. | One UX, two triggers (mirrors the save-conflict description below). |

Debounce banner appearance for 2 s so rapid broadcasts during a solve burst don't interrupt mid-drag.

**Open follow-up:** the `requestInitialData` fallback inside `handleSchemaUpdated` (when `removedIds` is empty) and `handleParametersAdded` (when `availableParams` is missing) currently round-trips through `initialData`, which under the new model will hit the *Banner* row above. Eliminating this fallback by ensuring those messages always carry enough payload to merge structurally is its own small refactor — out of scope here, flagged so the banner-on-add-param surprise doesn't get blamed on the canonical/draft split.

### Behaviour when the user saves

- UI sends `draft` + `baseSchemaHash` (content hash of the canonical it was forked from).
- C# computes hash of current `_embeddedSchema`.
- **Match** → apply (post-`ValidateSchema`) draft to `_embeddedSchema`. Reply to the saver with a directed `schemaSaved` carrying `newSchemaHash` and `newCanonical`. Also broadcast `schemaUpdated` to other clients (preview tabs). The saver applies the directed reply: replaces canonical, updates `canonicalHash`, clears `isDirty`, re-clones draft (or, if the user has mutated since the save fired, keeps the in-progress draft and stays dirty against the new canonical).
- **Mismatch** → reject via a new `schemaSaveRejected` message containing the current canonical and its hash. UI shows the same Review/Discard banner triggered by an `initialData` divergence. One UX, two triggers.

**Why a directed save-ack rather than relying on the broadcast:** between save-send and save-ack, the user may mutate the draft again (effects, automated edits, fast typing). If the UI cleared `isDirty` purely from a generic `schemaUpdated` broadcast, those post-send mutations would be silently destroyed by the re-clone — re-introducing the bug class this refactor is supposed to kill. A directed reply lets the UI atomically reconcile: I sent draft@H1, server accepted it as canonical@H2, and any draft mutation that happened *after* the send is preserved.

The content hash is the **only** version-like metadata in the system. It is:
- Computed on-demand from JSON, not stored anywhere.
- Used exclusively for save-conflict detection.
- Not a monotonic counter. No persistence question. No rehydration question.

**Hash serialization path (C#-only).** `SchemaHash.Compute(UISchema)` uses a *dedicated* `JsonSerializerSettings` — not the archive settings (`NullValueHandling.Ignore + DefaultValueHandling.Ignore`), not the transport settings (`WebSocketTransport.SecureSerializerSettings`). Its settings:
- `NullValueHandling.Include` and `DefaultValueHandling.Include` — no omission ambiguity. Two semantically-equal `UISchema` instances must produce byte-identical JSON regardless of whether a field happens to be null or default.
- An `IContractResolver` that emits members in alphabetical order — stable across Newtonsoft's reflection ordering.

The TS side never hashes. It receives `canonicalHash` on `initialData` / `schemaUpdated`, holds it opaquely, echoes it back as `baseSchemaHash` on save. This is intentional: avoids the cross-implementation canonicalization problem entirely, and the hash never needs to be reproducible outside C#.

Trade-off: the hash-targeted serialization is ~5% larger than transport JSON. Irrelevant — it's computed once per save / once per broadcast and never sent over the wire.

### Behaviour on navigation

- Today: navigating builder → preview auto-saves via `saveSchema()`.
- After: if `draft` is dirty, prompt explicitly: *"You have unsaved changes. Save / Discard / Cancel."* No silent auto-save.
- Cancel keeps the user in builder. Save runs the save flow (which may itself surface a conflict). Discard re-clones `draft` from `canonical` and proceeds.

### Behaviour on reload

- Today: localStorage is the source. Server is a fallback. Keyed by `sessionId`, which is regenerated on every component init — so cross-restart draft recovery silently doesn't work.
- After: server is the source. Always. UI fetches canonical from server, clones into draft.
- localStorage is re-keyed by **`documentId`** (`UISchema.DocumentId`, set C#-side from `GH_Document.DocumentID`, already broadcast on the schema — no new wire field needed).
- If localStorage has a draft tagged with the same `documentId` AND that draft is dirty, surface explicitly: *"You have unsaved layout changes from earlier. Restore them, or start from the current Grasshopper state?"* Never silently restore.
- If localStorage has a draft for a **different** documentId, drop it (this is the `purgeStaleSessions` behaviour, kept — purge predicate switches from `sessionId` to `documentId`).
- Multiple browser tabs against the same definition share the same draft slot (last write wins on the localStorage layer). Acceptable: this is identical to the current single-key-per-session behaviour and parallel-tab editing isn't a supported workflow.

### Behaviour for incoming `metadataUpdated` specifically

Subsumed by the broadcast policy table above: silent merge into both canonical and draft regardless of dirty state. Same `updateParameterMetadata` helper is applied to each.

### Undo/redo interaction with draft

- Undo/redo operates on `draft` only. `canonical` is read-only to the user.
- **`isDirty` is operation-flagged, not content-derived.** Flipped to `true` on first draft mutation in a session; cleared only by explicit save (after server-confirmed broadcast) or explicit discard. Undoing back to a state byte-identical to canonical does **not** clear `isDirty` — the user must explicitly discard to leave dirty state.
- **Undo stack is cleared on every canonical replacement** (`initialData`, `schemaUpdated`, `metadataUpdated` re-clone, or user-chosen discard). Snapshots taken against a stale canonical can't safely be replayed onto a new one. Clean break is the only honest UX. For dirty→discard, the conflict banner copy should make this consequence visible ("discarding will also clear undo history").
- **Undo stack is in-memory only.** localStorage holds the current draft and nothing else. The `LS_HISTORY_PREFIX` key family is removed; `LS_CURRENT_PREFIX` survives but is re-keyed by `documentId`.

### `backfillDropdownOptions` is removed

Today the UI patches missing dropdown options at load time. In the new model, dropdown options come from canonical at render time — no patching. Delete the function and its callsites.

---

## What this design rejects (and why)

### No schema versions (no monotonic counter)

Considered, rejected. A version on the schema only buys us:
- (A) stale-save rejection — solved by the content hash;
- (B) out-of-order broadcast handling — irrelevant on a single ordered WebSocket;
- (C) UI rebase identity for pending edits — irrelevant because we don't do pending edits / intents.

A counter also creates a persistence question: what version does the schema have when rehydrated from `.gh`? None of the answers are clean. The content hash sidesteps this entirely.

### No edit intents (no per-mutation wire protocol)

Considered as Phase 3 of an earlier draft, rejected. A complete intent surface would be **20–30 operations** (counted by grep against `packages/builder-app/src/lib/features/builder/operations.ts` plus widget-config edits). Each is a wire-protocol contract that must be maintained on both ends and codegen'd or hand-mirrored.

Costs:
- 20–30 typed C# message classes + 20–30 TS handlers.
- Per-intent `canApply(canonical) → ok | conflict` predicate for any rebase scenario.
- The pending-edit rebase logic is non-trivial — `useBuilderState` already shows how invasive layout mutation is (filter items, prune empty groups, prune empty tabs, re-point activeTabId).

Benefits we lose by not doing intents:
- Optimistic UI with sub-millisecond local feedback. **We don't need this on localhost WebSocket** — round-trip is 1–2 ms.
- Field-level dirty tracking. We replace this with a single `isDirty` flag plus explicit save/discard UX.

The full-schema-on-save approach is fine when saves are infrequent and explicit. With our model (no auto-save, save is a button or a confirmed navigation), the volume is low enough that sending a few KB of JSON costs nothing.

### No granular merge UI in the conflict banner

The "Review" button on the divergence banner shows a **coarse diff** — list of inputs added/removed, configs changed by count — with **Keep mine / Take theirs / Cancel**. Wholesale choice.

A per-field merge UI is the same complexity surface as intents (it's intents-by-the-back-door). We already have a granular sync flow (`syncPreview` / `ApplySyncChanges`) for the nickname/displayName case; if granular merging proves necessary for layout in practice, that's a follow-up — not a prerequisite.

---

## Phasing

Single phase. The design is small enough to ship in one pass without risk.

### What changes in C#

1. **`UISchema` content hash helper.** New static method `SchemaHash.Compute(UISchema)` — stable JSON serialization (sorted keys, `Include` null+default) → SHA-256 hex digest. Uses a dedicated `JsonSerializerSettings` instance separate from archive and transport. See the *Hash serialization path* note above.
2. **`BroadcastSchemaUpdate` / `BroadcastInitialData`** include `schemaHash` field.
3. **`HandleClientConnected` must write the broadcast schema into `_embeddedSchema`.** Today the connect path reads from ContextBake's volatile data and broadcasts directly without touching `_embeddedSchema` (`BridgeOrchestrator.cs:157-189`). Under the new model this breaks the canonical invariant: the UI forks its draft from the broadcast schema and tracks its hash, but `_embeddedSchema` may diverge (e.g. after `MergePostSolveBakeOutputs` or `metadataUpdated` mutate it). A subsequent save would then falsely reject because the hash computed on `_embeddedSchema` no longer matches what the UI was forked from. **Fix:** call `_setSchema(validatedSchema)` in `HandleClientConnected` before broadcasting, so `_embeddedSchema` and what was sent over the wire are guaranteed byte-identical. After this change, `_embeddedSchema` is genuinely canonical for everything.
4. **`HandleSchemaSaveRequested` in `BridgeOrchestrator`** takes a `baseSchemaHash` from the save message. Concrete wire shape:
   - Inbound `saveSchema` message gains a required `baseSchemaHash: string` field.
   - `WebSocketTransport.OnSchemaSaveRequested` event signature changes from `(sender, UISchema schema)` to `(sender, SchemaSaveRequest request)` where `SchemaSaveRequest { UISchema Schema; string BaseSchemaHash; }`.
   - If `baseSchemaHash` is null/empty/missing → reject via `BroadcastSchemaSaved(false, "missing baseSchemaHash")`. No legacy-tolerance path; plugin and UI ship in one `.gha` so version skew is not a concern.
   - If `baseSchemaHash` doesn't match `SchemaHash.Compute(_embeddedSchema)` → reject via new `schemaSaveRejected` reply containing the current canonical and its hash. UI surfaces the same Review/Discard banner.
5. **`BroadcastSchemaSaved` grows two fields on success:** `newSchemaHash: string` and `newCanonical: UISchema`. The UI uses this as a directed save-ack (path **B** from the save-flow design) — replaces canonical, updates `canonicalHash`, clears `isDirty`, re-clones draft (or, if the user has re-mutated since the save fired, keeps the in-progress draft). The broadcast `schemaUpdated` is still sent for other clients (preview tabs); the saving client ignores it because its hash already matches.
6. **`ValidateSchema` mutations on save are absorbed by the re-clone.** `_schemaSynchronizer.ValidateSchema(schema, document)` may mutate the schema (prune dead paramIds, refresh from canvas) before it's applied to `_embeddedSchema`. The hash on the save-ack is computed against the *post-validation* schema, not what the UI sent. The UI's post-save re-clone (step 5 above) absorbs this drift correctly. **Do not skip the re-clone on save success** — that would leave the UI showing pre-validation draft against post-validation canonical.
7. **Grasshopper-side undo is not specially handled.** `HandleSchemaSave` calls `RecordUndoEvent("Update Schema")`; if the user hits Ctrl+Z on the canvas, `_embeddedSchema` rolls back and any subsequent broadcast carries the rolled-back state. From the UI's perspective this is an ordinary canonical replacement — clean draft re-clones, dirty draft banners. No integration needed.
8. **Remove the auto-save behaviour** — no behaviour change on C# side, but verify there's no implicit auto-save anywhere.
9. **`MergePostSolveBakeOutputs`, `ApplyMetadataChangesToSchema`, `ApplySyncChanges`** continue to mutate `_embeddedSchema` and broadcast the updated canonical. No protocol change; merge policy is on the UI side per the broadcast table above.

### What changes in TS (builder-app)

1. **`useBuilderState` state shape:**
   - Replace `state.schema: UISchema | null` with `state.canonical: UISchema | null` and `state.draft: UISchema | null` and `state.isDirty: boolean` and `state.canonicalHash: string | null`.
   - All UI components read from `state.draft`.
   - `state.canonical` is mutated only by message handlers.
2. **`handleInitialData` / `handleSchemaUpdated`:** replace canonical, then either re-clone draft (if clean) or surface conflict banner (if dirty).
3. **`handleMetadataUpdated`:** patch canonical via existing `updateParameterMetadata`. If clean, re-clone draft. If dirty, banner. **Remove the `history.persistCurrentSchema` call I added in the last session — it's the wrong layer now.**
4. **`useSchemaHistory`:** scope to draft persistence only. Stores `draft` keyed by `documentId`. On load, checks for a draft and surfaces explicitly — never silently restores into canonical.
5. **`saveSchema`** sends `{ schema: draft, baseSchemaHash: state.canonicalHash }`. Handles a new `schemaSaveRejected` server message by triggering the conflict banner.
6. **`navigateTo('/preview')` in `+page.svelte`:** replace auto-save with a confirmation prompt when dirty.
7. **`backfillDropdownOptions`** removed. Verify dropdown options come from canonical at render time.
8. **All `state.schema = ...` mutation sites** become `state.draft = ...` and trip `isDirty = true`.

### What changes in preview UI

Preview has no draft layer — it's strictly read-only on the schema. But it is **not** a one-line rename; it's a small audit. Concretely in `usePreviewState.svelte.ts`:

- 3 `state.schema = ...` mutation sites in `handleInitialData`, `handleSchemaUpdated` — rename to `state.canonical`.
- In-place mutation via `updateParameterMetadata(state.schema, ...)` in `handleMetadataUpdated` — keep behaviour, retarget to canonical.
- 7 read sites across handlers — mechanical rename.
- `state.values` derivation logic depends on schema shape. The `removeParametersFromValues` path on `handleSchemaUpdated` continues to run on canonical updates exactly as today (no behavioural change).
- No `isDirty`, no draft, no banner UX. The broadcast policy table above does not apply to preview — preview applies every broadcast unconditionally to canonical.

`canonicalHash` is **not needed** in preview state — preview never saves, so it has no use for save-conflict detection. Preview just consumes whatever canonical the server sends.

### Test plan

- Manual: the original repro (preview → builder → preview with intermediate slider range edit) shows the new range in builder *and* still shows it after the round trip.
- Manual: edit something in builder, change slider range in GH while builder is open → banner appears (after 2 s debounce), draft is preserved, **Discard** clears draft to canonical, **Save** triggers conflict and reopens banner.
- Manual: edit in builder, close browser, reopen → prompted to restore the draft or use current Grasshopper state.
- Manual: edit in builder, navigate to preview → save/discard/cancel prompt fires.
- Verify `_embeddedSchema` in C# is not corrupted by the new save flow under rapid changes.

---

## What this design preserves

- Live preview updates from GH (slider value change, output recomputation).
- Live `metadataUpdated` updates in builder when the draft is clean.
- Crash recovery (draft persisted to localStorage).
- The existing `requestSyncPreview` / `ApplySyncChanges` flow for nickname/displayName reconciliation — orthogonal to this refactor.

## What this design changes from current UX

- Auto-save on builder → preview navigation is replaced by an explicit prompt.
- Live GH changes are visible in builder only when the user has no pending edits. When dirty, the user must decide.
- localStorage no longer silently overrides the server schema.

---

## Follow-up: wire-contract validation (Zod)

This is a separate but adjacent piece of work — owner has agreed to add it alongside this refactor.

### What it protects against

The bugs we found in this session (`metadataUpdated` sending `DiscoveredParameters` instead of a flat array, `parametersAdded` wrapping the payload under `data:` when the UI expects it flat) were both wire-format mismatches between the hand-written C# anonymous objects and the hand-written TS message types. They failed silently because:
- `forEach` on an object throws a `TypeError` that the WebSocket dispatcher swallows.
- Missing fields read as `undefined`, falling through to lazy fallbacks (e.g., `requestInitialData` round trip).

The codegen-from-shared-schema approach (long-term ideal) would prevent the bugs by construction. **Runtime Zod validation is a lighter intermediate step**: same JSON Schema source as today, but the TS dispatcher validates every inbound message before dispatching. Malformed messages fail loudly with a console error naming the offending field, instead of silently producing wrong UI state.

### Scope

- Hand-author Zod schemas for every `Ws*Message` type in `websocket.svelte.ts`. (Or codegen from `packages/schemas` — to be decided.)
- The `handleMessage` dispatcher runs each inbound message through the matching Zod schema before dispatching.
- On validation failure: log the validation error with the message type and the actual payload shape, drop the message, surface a one-off toast in dev mode.
- Production mode: same drop behaviour, no toast. Validation cost is acceptable (sub-ms for our message sizes).

### Why this is "and also" and not "instead of" the refactor

- The refactor (canonical/draft split) prevents silent data loss from layered state mismatches.
- The validator prevents silent data loss from wire-format mismatches.
- Both bugs we hit this session were one of each. Both fixes are needed.

### When to add it

After or alongside the refactor — order doesn't matter, no dependency between them. The validator can be added incrementally one message type at a time. Recommend starting with the two message types we already know were broken (`metadataUpdated`, `parametersAdded`) — guarantees regression coverage for the immediate bug class.

### Long-term

The validator is a strong forcing function for moving to codegen. Once every message type has a hand-authored Zod schema, the next step is generating both the Zod schemas and the C# DTOs from one source (a TypeSpec or JSON Schema definition). That's the architecture the `UISchema` already follows (`ui-schema.json` → `schema.ts` + `UISchema.Generated.cs`). Extending it to WebSocket messages eliminates wire drift permanently.

---

## Open questions to resolve at implementation time

1. **Draft-restore prompt UX.** Modal, banner, toast with two buttons? Recommend modal: it's a load-time decision, not a background notification.
2. **What counts as a draft mutation for `isDirty`?** Schema content yes; `activeTabId`, group `collapsed` state arguably no. Today `collapsed` lives in the schema — leave it there for now, treat it as dirty-triggering. Cleanup is a separate task.
3. **Hash algorithm.** SHA-256 is fine; collision resistance is overkill for this use case but the cost is negligible. Could use FNV-1a or xxhash for speed; not worth the complexity right now.
4. **JSON canonicalization for hash stability.** Newtonsoft does not sort object keys by default. Need to ensure the same logical schema produces the same hash on both sides if we ever hash on the TS side too. (We don't today — only C# computes the hash. The TS just echoes it back unchanged in `baseSchemaHash`. So canonicalization is only needed if hash is verified across implementations.)
