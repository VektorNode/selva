# `scene/`: the object list

An outliner panel's brain, with no DOM and no framework. Point it at a live `THREE.Scene` and it
answers:

- What in here counts as real content?
- How is it grouped into layers?
- What's hidden? What's selected?

It only **reads** the scene. Adding, removing and disposing content stays with `render/`.

## Basic use

```ts
import { createSceneOutliner } from '@selvajs/visualization/scene';

const outliner = createSceneOutliner(scene);

const layers = outliner.layerGroups(); // Map<layerName, Object3D[]>, render this
outliner.toggleObject(object); // hide/show (follows the selection if multi-selected)
outliner.select(object.uuid, { shiftKey: false, toggleKey: false });
```

Search is a parameter, not state: pass the same query to both calls so a shift-range doesn't span
filtered-out objects:

```ts
outliner.layerGroups('wall');
outliner.select(uuid, modifiers, 'wall');
```

## Call `applyTo()` after every solve

A solve throws away all scene content and rebuilds it, so whatever the user hid comes back visible.
`applyTo()` re-applies the hidden state to the new objects:

```ts
updateScene(scene, objects, camera, controls, true);
outliner.applyTo();
```

This works because hidden state is keyed by a stable tracking key, not by `uuid`: a fresh solve
produces fresh uuids. Selection is dropped: it pointed at objects that no longer exist.

## Making a UI re-render

The outliner's state is three plain `Set`s. Rather than inventing a subscription seam, it lets you
supply your own, so a framework's observable set makes your UI update on mutation.

Plain sets, for a headless tool:

```ts
const outliner = createSceneOutliner(scene);
```

Svelte, so mutations trigger a re-render:

```ts
import { SvelteSet } from 'svelte/reactivity';

const hidden = new SvelteSet<string>();
const selected = new SvelteSet<string>();

const outliner = createSceneOutliner(scene, {
	sets: { hidden, selected, collapsed: new SvelteSet<string>() }
});
```

**Then read that set directly in markup**: `outliner.visibility.isHidden(obj)` is not reactive under
runes and will render a correct value that never updates:

```svelte
{#if getMemberKeys(obj).every((k) => hidden.has(k))}…{/if}
```

`getMemberKeys` returns one key per source member, so hiding still tracks individual objects inside a
merged mesh.

## Files

| File            | What it does                                         |
| --------------- | ---------------------------------------------------- |
| `outliner.ts`   | `createSceneOutliner`, puts the rest together        |
| `objects.ts`    | what counts as content, and how to label it          |
| `identity.ts`   | tracking keys that survive a rebuild                 |
| `layers.ts`     | grouping by Grasshopper layer, plus search filtering |
| `visibility.ts` | hidden state, and re-applying it after a solve       |
| `selection.ts`  | click, ctrl-click, shift-range                       |

Only `createSceneOutliner` and a few helpers are exported. The parts are reachable through the
outliner (`outliner.visibility`, `.selection`), so they stay internal and can change freely.
