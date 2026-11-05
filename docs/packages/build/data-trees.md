---
title: Data trees
order: 3
published: true
description: 'What a Grasshopper data tree is, how branch paths work, and how to build solve inputs and read outputs.'
---

# Data trees

Grasshopper doesn't pass plain lists around. Every parameter holds a **tree**: a set of branches, each with a list of items. A solve takes trees in and gives trees back, so you need to know how to build and read them.

## What a tree looks like

A tree is a list of lists. Each inner list is a **branch**, and its **path** is its address.

![A data tree with two floors: each panel is a branch, and its path is the numbers on the way down.](/diagrams/data-tree.svg)

**The common case.** Most inputs are a single branch, which you can send as a plain value:

```
{0}  ● 10             → 10
{0}  ● ● ●  1, 2, 3   → [1, 2, 3]
```

Use several branches only when the definition processes groups separately, like points per panel. `{}` is the root branch, a path with no numbers.

## Building inputs

```ts
import { TreeBuilder } from '@selvajs/compute/grasshopper';

// Start from every input's default value.
let inputs = TreeBuilder.fromInputParams(io.inputs);

// A single value or a list goes to branch {0}.
inputs = TreeBuilder.replaceTreeValue(inputs, 'Radius', 10);
inputs = TreeBuilder.replaceTreeValue(inputs, 'Counts', [1, 2, 3]);

// A map of paths gives several branches.
inputs = TreeBuilder.replaceTreeValue(inputs, 'Points', { '{0}': [1, 2], '{0;1}': [3] });
```

- `replaceTreeValue` returns a new array. Ignore it and the solve sends the defaults.
- Inputs match by _nickname_, not display name. `io.inputs` lists both.
- A misspelled name adds a tree the definition ignores, with no error.

`TreeBuilder.fromValues` takes values straight from a UI and cleans them up: numbers are converted (integers rounded) and clamped to `minimum`/`maximum` with a warning, booleans accept `'true'`/`'false'`, unconvertible items are dropped with a warning, and an input left empty is omitted so Grasshopper uses its own value. `''` counts as an item. Objects are sent as JSON text.

## Reading outputs

```ts
import { GrasshopperResponseProcessor } from '@selvajs/compute/grasshopper';

const processor = new GrasshopperResponseProcessor(response);
const { values } = processor.getValues(); // every output, by name
const area = processor.getValue({ byName: 'Area' });
```

Items convert by type: text, numbers, booleans, file objects. An integer too large for a JavaScript number stays a digit string.

To keep branches, read the tree:

```ts
const branches = TreeBuilder.getTree(response.values, 'Points');
// Map { '{0}' => [...], '{0;1}' => [...] }, or null if there is no such output

const single = TreeBuilder.getTreeValue(response.values, 'Area');
// 5, not [5]. Throws INVALID_INPUT if the output has more than one branch.
```

## Geometry outputs

Pass a rhino3dm module to get Rhino geometry objects:

```ts
const result = processor.getValues(false, { rhino });
// ...use result.values...
result.dispose();
```

They live in WebAssembly memory that garbage collection can't free. Call `dispose()` after every solve and don't use the values afterward. Install `rhino3dm` yourself. To draw geometry in 3D, pass the response to `@selvajs/visualization/parse`.

## When an output is empty

No branches means the definition produced nothing: a missing input, a toggled-off branch, or an earlier component that failed. Call `setLogger(console)` from `/core` and set `debug: true` to see which outputs came back empty.
