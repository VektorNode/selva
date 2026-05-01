# Builder Sidebar Scalability & UX Redesign Plan

**Status:** Proposed
**Last updated:** 2026-05-01
**Owner:** Felix

## Goal

Make the Schema Builder UI in `@selvajs/builder-app` work as well with hundreds
of parameters across many groups/tabs as it does with a handful. Today the
sidebar and canvas are tuned for small schemas and break down at scale: the
"Schema Information" panel eats prime vertical space above the actually-used
parameter list, every placed parameter card renders fully expanded (description
+ advanced + visibility rules), the available-parameters list is flat with weak
filtering, the tab strip overflows, and there is no fast way to jump to a
specific group or item.

This plan rebuilds the sidebar and canvas chrome around shadcn-svelte
primitives, ships in independent phases, and pushes generic pieces back into
`@selvajs/ui` for reuse.

Headline outcomes:

- Schema Information collapses out of the way; Available Parameters takes the
  top of the sidebar.
- Placed parameter cards default to a single-row compact form (~32px) instead
  of a fully-expanded card (~120–250px).
- Available list filters by "unplaced only", groups by GH-name prefix, supports
  multi-type chips, and stays smooth at 500+ items via virtualization.
- A schema outline panel and cmd-K palette make navigation O(1) regardless of
  schema size.

## Non-goals

- Restyling the canvas itself (drop zones, group cards, line breaks) beyond
  the compact-card pattern in Phase 1.
- Changing the underlying drag-and-drop model (native HTML5 sidebar→group +
  `svelte-dnd-action` intra-group). Virtualization must adapt to the existing
  contract, not replace it.
- Putting any UI-only state into `@selvajs/schemas` UISchema types. Compact
  flags, sidebar width, recently-used lists, outline state all live in
  localStorage-backed stores keyed by sessionId.
- Mobile / touch redesign.
- Restyling the Interactive Preview view.

## Constraints

- Use shadcn-svelte primitives wherever possible. Generic primitives live in
  [`packages/ui/src/lib/components/primitives/`](../../packages/ui/src/lib/components/primitives/);
  domain-specific compositions stay in
  [`packages/builder-app/src/lib/components/builder/`](../../packages/builder-app/src/lib/components/builder/).
- Each phase is independently shippable. Stop at any phase and the app is
  better than before.
- Don't regress keyboard a11y. Every new collapsible must be keyboard-toggleable
  (bits-ui handles this); compact-card focus order must let users tab
  display-name → expand → remove → next card without trapping focus.

## Codebase facts that shape the plan

- **Layout root**:
  [`packages/builder-app/src/routes/builder/+page.svelte`](../../packages/builder-app/src/routes/builder/+page.svelte)
  uses a hard-coded `lg:grid-cols-[360px_1fr]`. Sidebar width is fixed.
- **Sidebar**:
  [`BuilderSidebar.svelte`](../../packages/builder-app/src/lib/components/builder/BuilderSidebar.svelte)
  stacks `<SchemaInfoPanel>` over two `<AvailableItemList>` instances (Inputs,
  Outputs).
- **Available list**:
  [`AvailableItemList.svelte`](../../packages/builder-app/src/lib/components/builder/AvailableItemList.svelte)
  already does search + type-select filtering and filters out placed IDs, but
  renders a flat `{#each}` inside a `max-h-150 overflow-y-auto` div — every
  DOM node lives even when scrolled off.
- **Param card**:
  [`BuilderGroupItem.svelte`](../../packages/builder-app/src/lib/components/builder/BuilderGroupItem.svelte)
  always renders Name + Description input + badge + Advanced collapsible +
  Visibility Rules collapsible — even when nothing is configured.
- **Drag system is split**:
  - Sidebar→Group uses **native HTML5 `draggable`** with `dragStore`
    ([`stores/dragStore.svelte.ts`](../../packages/builder-app/src/lib/stores/dragStore.svelte.ts))
    coordinating across boundaries.
  - Intra-group reorder uses **svelte-dnd-action** (`dndzone`).
  - Group reorder on the canvas uses **native HTML5** with
    `application/x-group` payload.
  - When sidebar drag is active, `dndzone` is disabled via
    `dragDisabled: isSidebarDragging`. **Any virtualization solution must
    preserve this contract.**
- **Available shadcn primitives** (in
  [`packages/ui/src/lib/components/primitives/`](../../packages/ui/src/lib/components/primitives/)):
  - **Exported** from `primitives/index.ts`: Button, Badge, Input, Search,
    Textarea, Label, Checkbox, Slider, Select, Card, Tabs, Dialog, Drawer,
    Alert, AlertDialog, ContextMenu, Separator, Switch, Toaster,
    ThemeSwitcher.
  - **Files exist but NOT exported**: `collapsible/`, `scroll-area/`,
    `resizable/` (paneforge), `field/`, `button-group/`. Phase 1 adds the
    exports.
  - **Does not exist**: `command/`, `dropdown-menu/`. Both must be added as
    new shadcn wrappers around bits-ui.
- **No virtualization library** is in `package.json` or pnpm catalog.
  Recommendation: `@tanstack/svelte-virtual`.

## Phases

Order: 1 → 2 → 3 → 6 → 4 → 5 → 7 → 8. Phase 6 (DropdownMenu primitive) is
moved before Phase 4 because it unblocks Phases 7 and 8.

---

### Phase 1 — Schema Info accordion + compact param card (S, 1–2d)

**User-visible change**

- Schema Information collapses to a single header row by default. Available
  Parameters now sits at the top of the sidebar.
- Placed parameter cards render in a compact one-line form by default
  (display name + GH nickname + type badge + remove). Description, Advanced,
  and Visibility Rules fold into a single expand-on-demand region.

**Concrete changes**

- Add `Collapsible` and `ScrollArea` exports to
  [`packages/ui/src/lib/components/primitives/index.ts`](../../packages/ui/src/lib/components/primitives/index.ts)
  (the component files already exist).
- Edit [`BuilderSidebar.svelte`](../../packages/builder-app/src/lib/components/builder/BuilderSidebar.svelte):
  reorder so Available Parameters renders first; wrap `<SchemaInfoPanel>` in
  `Collapsible.Root` with `bind:open` defaulting to `false`. Replace the
  card header with a `Collapsible.Trigger` (chevron, click anywhere to toggle).
  Persist open state in `localStorage` keyed by sessionId.
- Edit [`BuilderGroupItem.svelte`](../../packages/builder-app/src/lib/components/builder/BuilderGroupItem.svelte):
  split the body into an always-visible header row and a `details` region
  wrapped in a single outer `Collapsible.Root`. Header shows: drag handle,
  type icon, display-name input, GH nickname (truncated), type badge, expand
  chevron, remove. Add a small dot indicator on the chevron when description
  is non-empty, advanced config diverges from default, or visibility rules
  exist (so users see at-a-glance which params have non-default config).
  Compute via existing `hasVisibilityRules` and a new `hasCustomConfig`
  derived.
- Compact-state lives in a Svelte `$state` Map keyed by `item.id` at the
  `EditableGroup` level — not in UISchema.

**New reusable components:** None. All shadcn primitives.

**Risks / unknowns**

- Confirm `BuilderGroupItem`'s existing inner `showAdvanced` /
  `showVisibilityRules` collapsibles compose cleanly inside the new outer
  `Collapsible`. Likely fine; verify visually.

---

### Phase 2 — Resizable sidebar + ScrollArea + sectioned Available list (S, 1d)

**User-visible change**

- Sidebar is horizontally resizable.
- Inputs and Outputs become collapsible sections with persistent counts in
  their headers.
- Native scrollbars become consistent shadcn `ScrollArea`s.

**Concrete changes**

- Add `Resizable` export to `primitives/index.ts`.
- Replace the page grid in
  [`routes/builder/+page.svelte`](../../packages/builder-app/src/routes/builder/+page.svelte)
  with `<Resizable.PaneGroup direction="horizontal">`. Persist sizes to
  localStorage. Min/max widths e.g. 280px / 600px.
- In `AvailableItemList.svelte` wrap the list in `<ScrollArea>` and wrap each
  section header in `Collapsible.Trigger` with persisted state.
- In `BuilderSidebar.svelte` replace the outer `flex flex-col gap-6` with
  a single `<ScrollArea class="h-full">` so sticky section headers work.

**Risks / unknowns**

- `paneforge` at the page-grid level inside `<AppShell>` — verify AppShell's
  flex shape doesn't fight pane resizing.

---

### Phase 3 — Smarter Available Parameters filtering (M, 2–3d)

**User-visible change**

- "Unplaced only" toggle (default on).
- Group-by selector: GH category prefix, parameter type, or none.
- Multi-select type filter as badge chips (replaces single-select).
- Recently placed/dragged section pinned at the top.

**Concrete changes**

- Replace the single `Select` in `AvailableItemList.svelte` with a toolbar:
  `Switch` for "Unplaced only", `Select` for group-by, `Badge`-toggle row for
  types.
- Add `$derived` clustering: map `prefix → items[]` based on the first
  underscore segment of `nickname`. Render each cluster as
  `Collapsible.Root`.
- Add LRU recently-used store
  `packages/builder-app/src/lib/stores/recentParams.svelte.ts`, persisted to
  localStorage.
- Make the prefix function pluggable (single exported helper) so we can tune
  it on real data without touching list logic.

**Risks / unknowns**

- Real GH naming conventions vary per user. Confirm prefix derivation rule
  with the actual schemas Felix is shipping.

---

### Phase 6 — Tab overflow + new `DropdownMenu` primitive (S, 1–2d)

**User-visible change**

- When the tab strip overflows the canvas width, hidden tabs collapse into a
  "More ▾" dropdown showing remaining count.
- (Optional, deferred) Vertical-strip mode toggle.

**Concrete changes**

- **Add `DropdownMenu` to `@selvajs/ui`**:
  `packages/ui/src/lib/components/primitives/dropdown-menu/`. Wrap bits-ui's
  `DropdownMenu`, mirror the shadcn-svelte structure (root, trigger, content,
  item, separator, sub, ...). Export from `primitives/index.ts`. Reused by
  Phase 7 and Phase 8.
- Edit
  [`EditableTabNav.svelte`](../../packages/builder-app/src/lib/components/builder/EditableTabNav.svelte):
  add a `ResizeObserver` on the strip; compute which tab indices fit;
  render the overflow as `DropdownMenu`. Drop-on-overflow-button accepts a
  group drop into any hidden tab via the same `application/x-group` payload.

**Risks / unknowns**

- Tab title widths vary (editable). Recompute on tab list change as well as
  on resize.

---

### Phase 4 — Virtualize Available Parameters list (M, 3–5d + spike)

**User-visible change**

- Available list scrolls smoothly with hundreds of parameters; first paint
  stays sub-100ms regardless of count.

**Concrete changes**

- Add `@tanstack/svelte-virtual` to the pnpm catalog and to
  `packages/builder-app/package.json`.
- In `AvailableItemList.svelte`, replace the inner `{#each filteredItems}`
  with a virtualizer whose `getScrollElement` points at the ScrollArea's
  viewport.
- Virtualize the **flattened** list (cluster headers interleaved with rows)
  rather than per-cluster — single virtualizer is simpler.
- Do NOT introduce a `VirtualList` wrapper in `@selvajs/ui` yet. Keep the
  virtualizer call inside `AvailableItemList.svelte`. Generalize only after
  a second consumer appears.

**Risks / unknowns** (do a half-day spike before committing)

- Native HTML5 drag from a virtualized row is the central risk. Drag preview,
  `dragstart` payload, and `dragend` cleanup must keep working when the
  source row recycles mid-drag (drag → scroll → drop). Mitigation: pin the
  dragged row's index out of the recycle pool while a drag is active
  (`dragStore.current.id === item.id` → render at original slot, never
  recycle).
- Confirm bits-ui `ScrollArea` exposes the viewport element. If not, fall
  back to a plain `overflow-y-auto` div for the virtualized list (lose the
  styled scrollbar there only).
- Cross-browser `dragstart`: ensure the row component is keyed by `item.id`
  inside the virtualizer so recycled rows don't carry stale `draggable`
  attributes.

**Spike checklist**

1. Read
   [`packages/ui/src/lib/components/primitives/scroll-area/scroll-area.svelte`](../../packages/ui/src/lib/components/primitives/scroll-area/scroll-area.svelte)
   to confirm viewport is exposed.
2. Build a 500-item virtualized list with native HTML5 draggable rows;
   verify dragstart payload survives recycling and dragend doesn't leak;
   verify drop into an `EditableGroup` still calls `onParameterDrop`.
3. Verify `dndzone` inside an `EditableGroup` doesn't conflict with a
   virtualized sidebar (it shouldn't — different scroll containers — but
   confirm).

---

### Phase 5 — Schema outline / minimap panel (M, 2–3d)

**User-visible change**

- Toggleable right-pane outline listing every Tab → Group → Item. Click
  jumps to it (sets active tab + scrolls into view + brief highlight). Search
  filters the outline.

**Concrete changes**

- Add
  `packages/builder-app/src/lib/components/builder/SchemaOutline.svelte`
  (app-local). Reads schema from props; renders nested `Collapsible`s; emits
  `onJump(tabId, groupId, itemId)`.
- Add `data-item-id={item.id}` to `BuilderGroupItem` root and
  `data-group-id` to `EditableGroup`. Outline jump dispatches an event to
  set `activeTabId`, then `await tick()`, then
  `document.querySelector('[data-item-id=…]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })`,
  then a brief flash class.
- Wire into `routes/builder/+page.svelte` as a third `Resizable.Pane` (right
  side) with persisted size; only render when toggled on (button in
  `rightContent` of `<AppShell>`).

**Risks / unknowns**

- Don't virtualize the outline yet — it's only outline rows. Revisit at 500+
  items.
- Nested `Resizable.PaneGroup` behavior: paneforge supports it, but verify
  in a quick spike.

---

### Phase 7 — Bulk operations (M, 3–4d)

**User-visible change**

- Multi-select in Available list (shift/cmd-click). Drag the multi-selection
  to a group, or use a context-menu "Add N to…".
- "Place all unplaced" action per type (Inputs/Outputs) with a target picker.
- Multi-select in placed items inside a group → "Move to other group",
  "Delete", "Convert to ..." (extends existing batch processor).

**Concrete changes**

- Two small selection stores under `lib/stores/`:
  `availableSelection.svelte.ts` and `placedSelection.svelte.ts`.
- Edit
  [`DraggableItem.svelte`](../../packages/builder-app/src/lib/components/builder/DraggableItem.svelte)
  to react to selection state (shift-click toggles). Dragstart payload
  becomes a list when multi-selected:
  `{ dropType: 'input-batch', data: DiscoveredInput[] }`.
- Edit `EditableGroup.svelte`'s `onParameterDrop` and
  [`useBuilderActions.svelte.ts`](../../packages/builder-app/src/lib/composables/useBuilderActions.svelte.ts)
  to accept batch payloads (fan out to N adds, mirror existing single-item
  entry points).
- "Place all unplaced": dropdown button at top of each Available section
  opening a Tab/Group target picker via the new `DropdownMenu` primitive.

**Risks / unknowns**

- Multi-select drag preview is browser-dependent. Use a custom
  `setDragImage` rendering a small canvas with a "+N" badge.
- Within-group multi-select reorder is harder (svelte-dnd-action doesn't
  natively express n-at-a-time moves). Out of scope for v1; sequential
  N-add on drop is fine for sidebar→group.

---

### Phase 8 — Command palette (M, 3–4d)

**User-visible change**

- Cmd/Ctrl-K opens a palette. Fuzzy search across every parameter (placed
  and unplaced), every group, every tab, every action. Enter performs the
  action.

**Concrete changes**

- **Add `Command` primitive to `@selvajs/ui`**:
  `packages/ui/src/lib/components/primitives/command/`. Wrap bits-ui's
  cmdk-bits-ui Command. Standard shadcn-svelte structure: Dialog wrapper,
  CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty,
  CommandSeparator, CommandShortcut. Export from `primitives/index.ts`.
- Add
  `packages/builder-app/src/lib/components/builder/CommandPalette.svelte`
  (app-local). Mounts in `routes/builder/+page.svelte`, listens for cmd-k
  via the existing `handleKeydown`. Builds command items from schema +
  available params + a static action registry pulling from
  `useBuilderActions`.
- Reuse jump-to-item logic from Phase 5; if both consumers exist, extract
  to `lib/utils/jumpTo.ts`.

**Risks / unknowns**

- Index size: a few thousand items is well within cmdk's reach. Build the
  index lazily on first open and re-derive on schema change.

---

## What lands in `@selvajs/ui` vs. stays app-local

**Lifted into `@selvajs/ui` (generic primitives, reusable everywhere):**

- Phase 1: `Collapsible`, `ScrollArea` (export only — files exist).
- Phase 2: `Resizable` (export only — files exist).
- Phase 6: `DropdownMenu` (new wrapper).
- Phase 8: `Command` (new wrapper).

**Stays app-local in `builder-app` (domain-specific to the schema builder):**

- Compact card pattern (inside `BuilderGroupItem.svelte`).
- `SchemaOutline.svelte`.
- `CommandPalette.svelte`.
- Multi-select stores and the recently-used store.
- Prefix-grouping helper for the Available list.

## Cross-cutting rules

- **Schema purity**: no UI-only state in UISchema. All compact flags,
  sidebar widths, recently-used lists, outline state, palette index live in
  localStorage stores keyed by sessionId.
- **Keyboard a11y**: every new collapsible must be keyboard-toggleable
  (bits-ui handles this). Compact card focus order: display-name → expand →
  remove → next card. No focus trapping inside expanded panels.
- **Effort total**: ~17–25 dev-days end-to-end. Each phase is shippable
  independently.

## Recommended start

Phase 1 alone. 1–2 days, zero new deps, covers the original "Schema Info eats
space" complaint and the biggest density problem (compact cards). Re-evaluate
after Phase 1 lands before committing to Phases 2 and 3.
