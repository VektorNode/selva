# `scene/`

The bridge between parsed content and what a user sees listed. Given a live `THREE.Scene`, this
layer answers the questions any presentation of that scene has to answer — which children are actual
content, how do they group, what is hidden, what is selected — with no DOM and no framework.

## Contents

| File            | What it holds                                                           |
| --------------- | ----------------------------------------------------------------------- |
| `objects.ts`    | Content vs. viewer aid (`HELPER_IDS`), display labels, type prettifying |
| `identity.ts`   | Stable per-geometry keys that survive a solve                           |
| `layers.ts`     | Grouping by Grasshopper layer, search filtering                         |
| `visibility.ts` | Hidden-set bookkeeping, subtree `.visible` propagation, layer tri-state |
| `selection.ts`  | Click / ctrl-click / shift-range semantics                              |
| `outliner.ts`   | `SceneOutliner` — composes the above into one object-list state machine |

## What this layer does not do

It **reads** the scene graph and toggles `.visible`. It never adds, removes, or disposes anything —
`render/` owns scene content through `updateScene`, and two owners of one scene graph is how
double-dispose bugs start.

That split is why the outliner is safe to construct once and keep: it holds no object references of
its own, walking `scene.children` on each read instead.

## The framework seam

`SceneOutliner` is plain TypeScript, but its mutable state is intentionally injectable:

```ts
const outliner = createSceneOutliner(scene, { sets: { hidden, selected, collapsed } });
```

Pass plain `Set`s for a headless host. Pass Svelte's `SvelteSet` and every mutation the outliner
makes — `toggleObject`, `toggleLayer`, `select` — becomes a reactive read for the component
rendering it, with no subscribe/emit machinery in between. `SceneManager.svelte` in `@selvajs/ui`
does exactly that, in about 70 lines of script.

The catch: a framework observes the **set**, not the outliner. So a reactive host must read state
through the set it supplied (`hidden.has(getTrackingKey(obj))`) rather than through
`visibility.isHidden(obj)`, which reaches the same set by a plain reference the framework cannot see.

Two fields are not sets and so are handled separately: `searchQuery` (a plain property the host
assigns from its own state) and the shift-range anchor (push-notified via
`outliner.onAnchorChange(fn)`, which returns an unsubscribe).

**Who owns the outliner:** whoever owns the scene, not the panel. Hidden objects must stay hidden
while the outliner UI is closed, and `applyTo()` must keep running after every solve — so an
outliner that unmounts with its panel loses both. In `@selvajs/ui` it lives in `Viewer.svelte` and is
passed to `SceneManager.svelte` as a prop.

## Identity — call `applyTo()` after every solve

A solve does not update the scene in place: `updateScene` discards every object and rebuilds it. So
`THREE.Object3D.uuid`, which three assigns per _instance_, answers "which object is this right now"
but never "is this the same wall the user hid a minute ago".

Hidden state is therefore keyed by **stable identity** (`identity.ts`), synthesized from what the
parse layer records in `userData`:

| Priority | Source                                | Applies to                                 |
| -------- | ------------------------------------- | ------------------------------------------ |
| 1        | `userData.id`                         | display items (curves, points)             |
| 2        | `sourceComponentId` + `originalIndex` | meshes                                     |
| 3        | `name` + `layer`                      | content from plugin versions predating (2) |
| —        | instance `uuid`                       | fallback; cannot survive a solve           |

`applyTo()` re-hides everything in the hidden set against the new content. **A host must call it
after each solve** — nothing else will, and the user's hiding silently comes back visible if it is
missed. `Viewer.svelte` calls it inside the same `untrack` block that re-attaches edge overlays.

Two deliberate choices:

- **Hidden keys are never pruned.** If a definition edit stops producing some geometry, its key
  stays in the set, so hiding reapplies if that geometry returns. Hiding is a persistent user
  preference, not a property of the current solve.
- **`applyTo()` only hides, never shows.** Anything absent from the set keeps whatever visibility
  the render layer gave it, so this never fights another feature that hid something for its own
  reasons.

Selection is the opposite case: it is keyed by uuid and cleared on every `applyTo()`, because a
selection refers to instances that no longer exist.

**Looking hidden state up directly?** Use `getTrackingKey(object)`, not `getStableKey` — it applies
the uuid fallback. A reactive host needs this: `VisibilityState.isHidden` reads the backing set
through a plain reference, which a framework cannot observe.

## Extension points

The layer's parts stay separately composable **inside the package**, but the barrel publishes only
`createSceneOutliner` (plus the handle types and the two rendering helpers). That is deliberate: a
published symbol is a compatibility promise, and no consumer has needed these individually. Each is
one barrel line away if a real case turns up — add it then, with a consumer to justify it.

- **A different notion of "content"** — compose `isSceneContent` from [`objects.ts`](./objects.ts)
  rather than reimplementing the camera/light/helper filter.
- **A different grouping** — `groupByLayer` returns a plain `Map`; swap it for a group-by-material
  or group-by-object-type and the rest of the outliner is unaffected.
- **A headless consumer** — `getSceneObjects` + `groupByLayer` are enough to drive an export filter
  or a screenshot cropper without touching `SceneOutliner` at all.
