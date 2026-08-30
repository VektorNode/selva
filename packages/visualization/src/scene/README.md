# `scene/`

This folder helps you answer simple questions about a live `THREE.Scene`:

- What counts as real content?
- Which objects are hidden?
- Which ones are selected?
- How should they be grouped?

It does this without DOM code and without any framework.

## Files

| File            | What it does                                             |
| --------------- | -------------------------------------------------------- |
| `objects.ts`    | Decides what counts as scene content and how to label it |
| `identity.ts`   | Gives objects a stable ID so the same thing can be found |
| `layers.ts`     | Groups objects by Grasshopper layer and handles search   |
| `visibility.ts` | Tracks hidden objects and shows/hides whole branches     |
| `selection.ts`  | Handles click, ctrl-click, and shift-range selection     |
| `outliner.ts`   | Puts the pieces together in `SceneOutliner`              |

## What it does

`scene/` only reads the scene. It does not add objects, remove them, or dispose them.

`render/` owns the scene content and rebuilds it after each solve. `scene/` looks at that content
and tells you how it should behave.

## Basic use

Create one outliner for one scene:

```ts
const outliner = createSceneOutliner(scene);
```

If you want to keep track of hidden or selected objects yourself, pass your own sets:

```ts
const hidden = new Set<string>();
const selected = new Set<string>();
const collapsed = new Set<string>();

const outliner = createSceneOutliner(scene, {
	sets: { hidden, selected, collapsed }
});
```

## Common patterns

Hide something:

```ts
outliner.visibility.toggleObject(object);
```

Select something:

```ts
outliner.select(object);
```

Group by layer:

```ts
const layers = outliner.layers.groupByLayer();
```

Search the scene list:

```ts
outliner.searchQuery = 'wall';
```

Apply the saved hidden state after a new solve:

```ts
outliner.applyTo();
```

## A few examples

### Example 1: Headless tool

If you do not use a UI framework, plain `Set`s are enough.

```ts
const hidden = new Set<string>();
const selected = new Set<string>();

const outliner = createSceneOutliner(scene, {
	sets: { hidden, selected, collapsed: new Set<string>() }
});
```

### Example 2: Reactive UI

If your UI tracks changes reactively, pass in the set that the UI already watches.

```ts
const hidden = new SvelteSet<string>();
const selected = new SvelteSet<string>();

const outliner = createSceneOutliner(scene, {
	sets: { hidden, selected, collapsed: new SvelteSet<string>() }
});
```

Then read the set directly in your UI:

```ts
hidden.has(getTrackingKey(object));
```

### Example 3: After each solve

After the scene is rebuilt, call `applyTo()` again so old hidden objects stay hidden.

```ts
updateScene(scene, objects, camera, controls, false);
outliner.applyTo();
```

## One important rule

The scene changes after every solve, so object IDs based on `uuid` are not stable enough. `scene/`
uses its own tracking keys instead, which are meant to survive rebuilds.

## What it does not do

- It does not build scene content.
- It does not render anything.
- It does not own the objects in the scene.

## Why the barrel stays small

The package exports the main entry point and a few helpers, not every internal function. That keeps
the public API smaller and easier to change later.

If you need a lower-level helper, you can import it from its file inside the package while you are
working locally. If it turns out to be useful for others, it can be exported later.
