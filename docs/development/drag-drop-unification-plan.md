# Drag-Drop Unification Plan

## Status

**Draft — pending execution.** Scoped as a single focused PR (PR 1). Cross-tab item drag (PR 2) and multi-select (PR 3) are deliberate follow-ups, not bundled here.

This plan was stress-tested through a structured grilling session. Every architectural decision below is locked; deviations should update this document first.

## Why

The builder-app currently runs **three drag systems simultaneously**:

1. **Native HTML5 DnD** + a custom `dragStore` singleton — sidebar → group, group reordering, tab reordering, group-onto-tab.
2. **`svelte-dnd-action`** — item reordering inside a group.
3. **MIME-type sniffing** (`application/x-group`) — used to disambiguate drag kinds in [EditableTabNav.svelte:41](../../packages/builder-app/src/lib/components/builder/EditableTabNav.svelte#L41).

These don't share state. `dragStore` knows about sidebar drags; `dataTransfer.types` knows about group drags; `svelte-dnd-action` knows about item drags. Code in [TabEditor.svelte:54-59](../../packages/builder-app/src/lib/components/builder/TabEditor.svelte#L54-L59) and [EditableGroup.svelte:75-78](../../packages/builder-app/src/lib/components/builder/EditableGroup.svelte#L75-L78) has to *manually disable* one system when another is active. Every new drag interaction needs a new "is the other system active?" guard. That is the structural problem.

### Concrete fragility hotspots

- **`dragStore` can leak.** Module-level singleton cleared in `dragend`, but cancelled drags or thrown exceptions between `set` and `clear` leave stale state.
- **Drop acceptance has a band-aid fallback.** [DropZone.svelte:32-44](../../packages/builder-app/src/lib/components/builder/DropZone.svelte#L32-L44) has a "still allow drop even if dragStore is empty" branch — exists because the store isn't always trustworthy.
- **`dragOver`/`dragLeave` flicker logic is reimplemented per component.** The `relatedTarget.contains` check appears in DropZone, TabEditor, and EditableGroup.
- **Six different "something is being dragged-over me" flags** owned by different components: `isItemDragging`, `isSidebarDragging`, `dragOverGroupId`, `dragOverTabId`, `isOver`, `isActive`.
- **DOM-walking handle detection.** `handleGroupDragStart` in [TabEditor.svelte:61-82](../../packages/builder-app/src/lib/components/builder/TabEditor.svelte#L61-L82) walks the DOM to detect whether the user grabbed an input/button instead of the handle.
- **Dead/misleading types.** `DragPayload` includes `'group' | 'tab'` variants ([dragStore.svelte.ts:13](../../packages/builder-app/src/lib/stores/dragStore.svelte.ts#L13)) that the actual code doesn't use.

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Architecture layers | **One layer.** Pure `svelte-dnd-action` everywhere. No native HTML5 DnD anywhere. No coordinator file. |
| 2 | Sidebar source structure | **One `dndzone` per cluster.** Each rendered cluster (`'none'`, `'prefix'`, `'type'`, `'ghGroup'` modes) wraps its `{#each}` in a dndzone. Mounts/unmounts with the existing `Collapsible.Content`. |
| 3 | Sidebar item lifecycle | **Move semantics, no user-visible "copy".** Already-true behaviour: `AvailableItemList` derives `availableInputs.filter(!placedSet.has(id))`. Dndzone's source-list mutation is a no-op for us — the sidebar refreshes itself. Sidebar dndzones are `dropFromOthersDisabled: true` (read-only sources). |
| 4 | Sidebar entry points | **Keep both drag-drop AND right-click context menu.** Context menu is the keyboard/a11y path. |
| 5 | Cross-type drop strategy | **Transform on `finalize` (Option 1).** When a foreign-shaped item lands in a destination zone, route it through `handleItemDrop` (for params) or `onMoveGroupToTab` (for groups). Live-preview placeholder for sidebar drops shows span 1, which matches the actual default span of new items — accidentally correct. |
| 6 | Group-on-tab drops | **Tab dndzone accepts both `selva-group` and tab items.** `consider` filters out the foreign group so the placeholder never appears in the tab strip; `finalize` shape-detects (`GroupConfig` vs `TabConfig`) and routes. |
| 7 | Drag handles | **`dragHandleZone` + `dragHandle` on GripVertical** for group items, groups in tab, tabs in nav. **Whole-card draggable** for sidebar items (no inner controls to misclick; small surface). |
| 8 | History granularity | **One snapshot per completed drag**, on the destination's `finalize`. Source zone uses `DROPPED_INTO_ANOTHER` trigger to skip its own commit. |
| 9 | Keyboard a11y | **Enabled** on items/groups/tabs (default). **Disabled** on sidebar dndzones (`autoAriaDisabled: true`) — keyboard users use the context menu instead of tabbing through hundreds of params. |
| 10 | DropZone component | **Deleted.** Empty-state and drop-target highlight handled inline via dndzone's `dropTargetClasses` + `{#if items.length === 0}` overlay. |
| 11 | Span lookup hack | **Stays inline in `EditableGroup.svelte`.** Specific to grid-column rendering; one caller; no need to generalise. |
| 12 | Positioned sidebar drops | **Wired up.** dndzone gives us the exact target index in `finalize`; we compute `targetItem` + `dropPosition` and pass to `handleItemDrop`. Free with the one-layer architecture; strictly better UX than today's always-append. |
| 13 | Dndzone type constants | **`selva-param`** (sidebar + group items) and **`selva-group`** (groups + tab nav). Prefixed to avoid collisions in dndzone's global type namespace. Exported as `DND_TYPE_PARAM` / `DND_TYPE_GROUP`. |
| 14 | Drop-target highlight | **Uniform `ring-2 ring-primary`** for all valid drop targets. Distinction between "reorder" vs "cross-type" is conveyed by what's being dragged, not the target. |
| 15 | History (existing) | **Already exists** via `builderState.history.push($state.snapshot(schema))`. PR 1 just preserves it. |
| 16 | Refactor size | **One focused PR, ~1 day, behavioural parity** (plus the free positioned-drops feature). |
| 17 | Test coverage | **Unit tests** for `dndzone-helpers` + action handlers. **No DOM-level dnd tests** — `svelte-dnd-action` is tested upstream; Playwright drag is flaky. |
| 18 | Stretch features | **NOT in this PR** — see Out of Scope. |

## Architecture

### Sidebar lifecycle (verified)

[AvailableItemList.svelte:100](../../packages/builder-app/src/lib/components/builder/AvailableItemList.svelte#L100) derives the visible list as `availableInputs.filter(!placedSet.has(id))`. `availableInputs` is the immutable catalog of what Grasshopper exposed — never mutated during drag. Once a param is referenced by a layout item, the sidebar entry disappears automatically. No manual remove call required, and no "copy" semantics in the user-visible sense.

### One layer, two `type`s

`svelte-dnd-action` enforces same-`type` drops. We unify everything into two type-spaces:

- **`selva-param`** — sidebar dndzones (one per cluster, read-only) AND group-items dndzones. A `DiscoveredInput` from the sidebar can drop into any group's items zone.
- **`selva-group`** — groups dndzone (one per tab) AND tab nav dndzone. A `GroupConfig` can drop onto a tab header.

There is no third "coordinator" file. dndzone is the only drag system. Cross-type concerns (foreign-shaped items landing in a destination) are handled by shape-detection in the destination's `finalize` body.

### Cross-type drops via shape detection

When a sidebar item drops into a group's items zone:

1. `consider` fires repeatedly during drag. The dragged element is a `DiscoveredInput`, not a `LayoutItem`. The placeholder rendering in EditableGroup ignores the dragged content (it just renders a dashed box at the right span), so the shape mismatch is invisible.
2. `finalize` fires once on drop. The destination zone scans `e.detail.items` for any item that doesn't match `LayoutItem` shape (no `paramId`, has a sidebar-shape signature). For each foreign item, it computes `targetItem` + `dropPosition` from its neighbours in the array, removes it from the array, and calls `handleItemDrop({ ...args, targetItem, dropPosition })`. Then commits the resulting `group.items` and pushes a single history snapshot.
3. The sidebar entry vanishes on its own — `placedSet` recomputes once `group.items` references the new param's id.

Same pattern for group-on-tab: tab nav's `consider` drops the foreign `GroupConfig` from its placeholder list (so the tab strip stays clean); `finalize` shape-detects and routes to `onMoveGroupToTab(...)`. Source group dndzone sees `DROPPED_INTO_ANOTHER` and skips its own commit.

### Drag handles

`dragHandleZone` is the dndzone variant where only elements marked with `use:dragHandle` initiate a drag. Used in three places:

- Group items: `dragHandle` on the GripVertical at [BuilderGroupItem.svelte:200-207](../../packages/builder-app/src/lib/components/builder/BuilderGroupItem.svelte#L200-L207). Today it's decorative; this refactor makes it real.
- Groups in a tab: `dragHandle` on the GripVertical in EditableGroup's header.
- Tabs: `dragHandle` on the GripVertical in EditableTabNav.

Sidebar items keep whole-card-draggable (no inner controls; small surface; clicking the card to drag is the natural gesture). They use plain `dndzone`, not `dragHandleZone`.

### Positioned sidebar drops (new feature, free with architecture)

Today, sidebar items always append to the end of a group regardless of where the user drops them — `handleItemDrop`'s `targetItem`/`dropPosition` parameters exist but the current `DropZone` doesn't fill them in. The one-layer architecture gives us the exact drop index from `e.detail.items` in `finalize`. We compute `targetItem` from the surrounding items and pass it through. Strictly better UX than today; net code change is small.

## Files to change

### 1. `packages/builder-app/src/lib/dnd/dndzone-helpers.ts` *(new)*

```ts
export const DND_TYPE_PARAM = 'selva-param';
export const DND_TYPE_GROUP = 'selva-group';

// Snapshot-on-finalize wrapper. Enforces "one history push per drag",
// prevents the consider-flood footgun.
export function createDndHandlers<T>({ getSnapshot, onCommit }): {
  localItems: T[];
  consider: (e: CustomEvent<DndEvent<T>>) => void;
  finalize: (e: CustomEvent<DndEvent<T>>) => void;
};

// Shape type-guards for finalize bodies.
export function isLayoutItem(x: unknown): x is LayoutItem;
export function isDiscoveredInput(x: unknown): x is DiscoveredInput;
export function isDiscoveredOutput(x: unknown): x is DiscoveredOutput;
export function isGroupConfig(x: unknown): x is GroupConfig;
```

~40 lines total. No clever abstractions; just enforces the snapshot-once rule and provides shape detection.

### 2. `packages/builder-app/src/lib/stores/dragStore.svelte.ts` *(deleted)*

### 3. `packages/builder-app/src/lib/components/builder/DropZone.svelte` *(deleted)*

Empty-state message becomes inline markup in `EditableGroup.svelte`, conditionally rendered when `group.items.length === 0`. Drop-target ring comes from dndzone's `dropTargetClasses: ['ring-2', 'ring-primary']`.

### 4. `packages/builder-app/src/lib/components/builder/AvailableItemList.svelte`

- Each `{#each cluster.items}` wrapped in `dndzone({ items: cluster.items, type: DND_TYPE_PARAM, dragDisabled: false, dropFromOthersDisabled: true, autoAriaDisabled: true })`.
- For `groupBy === 'none'`, the single cluster's `{#each}` gets one dndzone.
- Each dndzone lives inside its existing `Collapsible.Content`; mounts/unmounts naturally on cluster expand/collapse.
- No `consider`/`finalize` handlers wired (sidebar zones are read-only sources; nothing to commit).

### 5. `packages/builder-app/src/lib/components/builder/DraggableItem.svelte`

- Remove `dragstart`/`dragend` handlers, the `draggable="true"` attribute, the `dragStore` import.
- The element becomes a passive dndzone child — dndzone manages drag initiation.
- Right-click context menu paths unchanged.
- Net: ~30 lines deleted.

### 6. `packages/builder-app/src/lib/components/builder/EditableGroup.svelte`

- Inner items dndzone replaced with `dragHandleZone` of `type: DND_TYPE_PARAM`. Items remain `LayoutItem`.
- Use `createDndHandlers` for the consider/finalize wiring.
- `finalize` body: shape-detect foreign items in the array (any item where `isDiscoveredInput(i) || isDiscoveredOutput(i)`), compute `targetItem`/`dropPosition` from neighbours, route through `handleItemDrop`. Commit final `group.items`, snapshot once.
- Span-lookup hack at lines 83-97 stays inline; behaviour unchanged.
- Inline empty-state: `{#if group.items.length === 0}` renders the "Drag parameters here" overlay (replaces deleted DropZone).
- Drop-target ring: `dropTargetClasses: ['ring-2', 'ring-primary']`.
- Remove `isSidebarDragging` derived (no coordinator to read).
- `BuilderGroupItem`'s GripVertical gets `use:dragHandle`.

### 7. `packages/builder-app/src/lib/components/builder/TabEditor.svelte`

- Native HTML5 group-reorder code (lines 49-125) replaced with one `dragHandleZone` of `type: DND_TYPE_GROUP` over `activeTab.groups`.
- `finalize` calls `onReorderGroups`. `consider` updates local items for the live preview.
- All native `ondragover`/`ondragleave`/`ondrop` handlers on the group wrapper deleted.
- The `EditableGroup`'s header GripVertical gets `use:dragHandle` (the action travels with EditableGroup, not TabEditor — TabEditor just declares the dragHandleZone over the groups).
- Net: ~70 lines deleted.

### 8. `packages/builder-app/src/lib/components/builder/EditableTabNav.svelte`

- Native HTML5 tab-reorder code replaced with one `dragHandleZone` of `type: DND_TYPE_GROUP` over `tabs`. (Same type as groups so groups can drop in.)
- `consider` filters out any incoming foreign item (a `GroupConfig`) from the placeholder list — the tab strip never shows a "ghost tab" for group drops. Instead, when consider sees a foreign item over a specific tab, set a local `dragOverTabId` flag for ring highlighting on that tab.
- `finalize` shape-detects:
  - `TabConfig` items reordered in place → call `onReorderTabs(fromIndex, toIndex)`.
  - `GroupConfig` foreign item → resolve target tab from `dragOverTabId`, call `onGroupDropOnTab(targetTabId, groupId)`.
- All `application/x-group` MIME-type sniffing deleted.
- Tab GripVertical gets `use:dragHandle`.
- Net: ~80 lines deleted.

### 9. `packages/builder-app/src/lib/composables/useBuilderActions.svelte.ts`

No API changes. The existing handlers (`onParameterDrop`, `onReorder`, `onReorderTabs`, `onReorderGroups`, `onMoveGroupToTab`) are called from the same call sites with the same arguments. `createDndHandlers` enforces one snapshot per drag — no per-mutation snapshot proliferation.

### 10. Tests *(new)*

- `packages/builder-app/src/lib/dnd/dndzone-helpers.test.ts` — shape type-guards, `createDndHandlers` snapshot timing (one push per finalize, zero per consider), `DROPPED_INTO_ANOTHER` skip-on-source.
- `packages/builder-app/src/lib/composables/useBuilderActions.test.ts` — pin already-implicit history behaviour (one snapshot per logical operation) so PR 1 can't regress it.

No DOM-level dnd tests. svelte-dnd-action is tested upstream; Playwright drag simulation is flaky.

## Out of scope (deliberate)

| Item | Why deferred |
|---|---|
| Cross-tab item drag (drop a parameter directly on a tab header) | Trivial follow-up on the unified base; UX change deserves its own PR (PR 2). |
| Multi-select drag (shift-click, drag a batch) | Real complexity (selection model, drag-image, partial-failure). Validate need first (PR 3). |
| Undo/redo | **Already exists.** Every action calls `builderState.history.push(...)`. PR 1 just preserves it. |
| Touching `preview/+page.svelte` | No drag-drop in that file — incidental context only. |
| FileInput's drop handling in `@selvajs/ui` | Different domain (OS file uploads in user-facing forms). No shared code with builder. |

## Risks & mitigations

- **Cluster regrouping mid-drag.** If `availableInputs` changes while a drag is in progress (Grasshopper sends new params), the cluster array could mutate. Accepted as non-issue: rare, and worst case the drag ends weirdly and the user retries. Don't add machinery for it.
- **Empty group dndzone.** Empty `dndzone` containers are fine — they accept drops. Inline `{#if items.length === 0}` overlay shows the message; dndzone's `dropTargetClasses` provide the ring.
- **History granularity for cross-zone moves.** One snapshot via `DROPPED_INTO_ANOTHER`-aware source + finalize-only destination commit.
- **dndzone global type namespace.** `selva-` prefix on type constants prevents collision with future dndzones added elsewhere.

## Smoke test checklist (manual, before merge)

1. Sidebar input → empty group
2. Sidebar input → group with items, dropped between two specific items (positioned drop — new behaviour)
3. Sidebar output → group
4. Reorder items within a group (mouse)
5. Reorder items within a group (keyboard: tab to handle, space, arrows, space) — **new capability**
6. Reorder groups within a tab
7. Drag group onto a different tab header
8. Reorder tabs (mouse + keyboard)
9. Cancel drag mid-flight (Esc) — no stale state, no half-committed changes
10. Right-click "Add to existing/new group" still works
11. Undo (Ctrl+Z) reverses each of the above as a single step
12. Drag with sidebar search active — search input doesn't break drag, drag doesn't break search
13. Drag from a collapsed cluster (verify it's not draggable) and from an expanded cluster
14. Drag onto a line-break — item lands in the correct row

## Follow-ups (not part of this PR)

- **PR 2 — Cross-tab item drag.** Once unified, drop a sidebar item or group item directly onto a tab header. Half a day. Don't bundle into PR 1 — UX change.
- **PR 3 — Multi-select drag.** Several days. Punt until PRs 1+2 are validated in real use.
