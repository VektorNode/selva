---
title: Data trees
order: 2
published: true
description: 'What a Grasshopper data tree is, how branch paths work, and how to build solve inputs and read outputs.'
---

# Data trees

Grasshopper doesn't pass plain lists around. Every parameter holds a **tree**: a set of branches, each with a list of items. A solve takes trees in and gives trees back, so you need to know how to build and read them.

## What a tree looks like

Each branch has a **path**, such as `{0}`, `{0;1}` or `{2;0;5}`. A path is like an address in nested lists.

```
{0}    → [1, 2, 3]
{1}    → [4, 5]
{1;0}  → [6]
{}     → [7]        the root branch, a path with no numbers
```

Most inputs are simple: a single branch, `{0}`, with one value or a short list. Trees matter when a definition expects grouped data, such as one list of points per panel.

## Building inputs

`TreeBuilder` creates the trees a solve sends.

```ts
import { TreeBuilder } from '@selvajs/compute/grasshopper';

// Start from every input's default value.
let inputs = TreeBuilder.fromInputParams(io.inputs);

// A single value goes to branch {0}.
inputs = TreeBuilder.replaceTreeValue(inputs, 'Radius', 10);

// A list also goes to {0}.
inputs = TreeBuilder.replaceTreeValue(inputs, 'Counts', [1, 2, 3]);

// A map of paths gives you several branches.
inputs = TreeBuilder.replaceTreeValue(inputs, 'Points', { '{0}': [1, 2], '{0;1}': [3] });
```

Three habits prevent most mistakes:

1. **Use the returned value.** `replaceTreeValue` gives you a new array and leaves the old one alone. If you ignore the result, the solve sends the defaults.
2. **Use the nickname.** Inputs are matched by their _nickname_, not their display name. `io.inputs` lists both.
3. **Check the name.** If you misspell a name, `replaceTreeValue` adds a new tree that the definition ignores, without any error.

### Building from raw values

`TreeBuilder.fromValues` is meant for values that come straight from a UI. It cleans them up the way Grasshopper expects:

- Number and Integer items are converted to numbers. Integers are rounded.
- Numbers are limited to the input's `minimum` and `maximum`, and a warning is logged when one is changed.
- Boolean items also accept the text `'true'` and `'false'`.
- An item that can't be converted is dropped, with a warning.
- An input left with no items is left out, so Grasshopper uses its own value. An empty string `''` counts as an item, not as "nothing".

Objects are sent as JSON text. Numbers and booleans keep their type.

## Reading outputs

Use the processor to get ready-to-use values:

```ts
import { GrasshopperResponseProcessor } from '@selvajs/compute/grasshopper';

const processor = new GrasshopperResponseProcessor(response);
const { values } = processor.getValues(); // every output, by name
const area = processor.getValue({ byName: 'Area' });
```

Each item is converted by its type: text to text, integers and decimals to numbers, true/false to booleans, and files to file objects. An integer too large for a JavaScript number stays as a string of digits, so it isn't rounded by mistake.

To keep the branch structure, read the tree itself:

```ts
const branches = TreeBuilder.getTree(response.values, 'Points');
// Map { '{0}' => [...], '{0;1}' => [...] }, or null if there is no such output

const single = TreeBuilder.getTreeValue(response.values, 'Area');
// One item as itself (5, not [5]); several items as an array.
// Throws INVALID_INPUT if the output has more than one branch.
```

Use `getTreeValue` only for outputs that always have one branch. Otherwise use `getTree`.

## Geometry outputs

To get Rhino geometry as rhino3dm objects, pass a rhino3dm module:

```ts
const result = processor.getValues(false, { rhino });
// ...use result.values...
result.dispose();
```

These objects live in memory that JavaScript can't clean up by itself. Call `dispose()` when you're done with the values, after every solve, or memory use keeps growing. Don't use the values after that. Install `rhino3dm` yourself: this package doesn't include it.

To draw geometry in 3D, pass the response to `@selvajs/visualization/parse` instead.

## When an output is empty

An output with no branches means the definition produced nothing for it. That isn't always a mistake. Common causes are a missing input, a branch switched off by a toggle, or an earlier component that failed. To see which outputs came back empty, call `setLogger(console)` from `/core` and set `debug: true` in the client config.
