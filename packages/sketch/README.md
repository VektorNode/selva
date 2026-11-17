# @selvajs/sketch

Points, lines, polylines and NURBS curves as Grasshopper inputs: draw them in a
[`@selvajs/visualization`](../visualization) viewer, import them from DXF or 3DM, and encode them
so Rhino.Compute reads them through a stock Get Point, Get Line or Get Geometry.

Three entrypoints, no root entry. Each layer imports only the ones above it in this table.

| Entry    | Holds                                                                | Needs                             |
| -------- | -------------------------------------------------------------------- | --------------------------------- |
| `/model` | Item types, NURBS evaluation, lengths, edits, Grasshopper paths      | nothing                           |
| `/io`    | DXF reader, Rhino archive codec, 3DM reader                          | `rhino3dm` for the Rhino parts    |
| `/tool`  | The draw tool, and the curve layer and point picker it is built from | `three`, `@selvajs/visualization` |

## Items

```ts
import { nurbsFromControlPoints, type SketchItem } from '@selvajs/sketch/model';

const items: SketchItem[] = [
	{ kind: 'point', at: [500, 500, 0] },
	{ kind: 'line', from: [0, 0, 0], to: [1000, 0, 0] },
	{
		kind: 'polyline',
		closed: true,
		points: [
			[0, 0, 0],
			[1000, 0, 0],
			[1000, 500, 0]
		]
	},
	nurbsFromControlPoints([
		[0, 0, 0],
		[300, 400, 0],
		[700, -400, 0],
		[1000, 0, 0]
	])
];
```

Coordinates are in the definition's model units and Rhino's axes. A closed polyline does not repeat
its first point. A NURBS curve carries the full knot vector (`points.length + degree + 1`) and
unweighted points with separate `weights`; the Rhino codec converts both conventions.

Every item may also carry three tags, which every edit keeps:

| Tag          | What it is                                                                           | Reaches Rhino as                        |
| ------------ | ------------------------------------------------------------------------------------ | --------------------------------------- |
| `id`         | A stable name while the item is edited in the browser. The draw tool gives one.      | not sent                                |
| `path`       | The Grasshopper branch, `[0, 1]` for `{0;1}`. Items sharing a path arrive as a list. | the data tree's branches                |
| `attributes` | Text by key, such as a role or a height.                                             | user strings (Get Geometry inputs only) |

`groupByPath(items)` gives the branches; `pathKey` and `parsePath` convert to and from `{0;1}`.

## Sending items to Rhino.Compute

A Get Point or Get Line input takes plain JSON. A Get Geometry input takes Rhino's archive JSON,
which only rhino3dm writes, so those functions take the loaded module:

```ts
import rhino3dm from 'rhino3dm';
import { encodeItem, decodeItem, lineToRhinoJson, pointToRhinoJson } from '@selvajs/sketch/io';

const rhino = await rhino3dm();
const geometryValue = items.map((item) => encodeItem(rhino, item)); // Get Geometry
const lineValue = [lineToRhinoJson(line)]; // Get Line
const pointValue = [pointToRhinoJson(point)]; // Get Point
```

Pass a list as the input's value to `TreeBuilder.fromValues` (`@selvajs/compute`): each item
becomes one item of branch `{0}`. For a data tree, pass a map of path to list instead:
`{ '{0;0}': [...], '{0;1}': [...] }`.

`decodeItem` reads a Rhino curve or point back, with its user strings; arcs, circles and polycurves
come back as NURBS.

## Importing

```ts
import { parseDxf, read3dm } from '@selvajs/sketch/io';

const dxf = parseDxf(await file.text());
const model = read3dm(rhino, new Uint8Array(await file.arrayBuffer()));
```

Both return `items` in the file's own units with `metersPerUnit` (null when the file states none),
and report what they skipped.

DXF reads POINT, LINE, LWPOLYLINE, POLYLINE, SPLINE, ARC and CIRCLE from the ENTITIES section. Arcs
and bulged polyline segments become exact rational NURBS, not tessellated polylines. Block
references (INSERT), ELLIPSE, fit-point-only splines and binary DXF are not read.

## Drawing in a viewer

```ts
import { createSketchTool } from '@selvajs/sketch/tool';

const tool = createSketchTool({
	viewer, // ThreeViewer from initThree
	id: 'outline',
	metersPerUnit: 0.001, // the scene is in metres; this model is in millimetres
	unitSuffix: 'mm',
	onChange: (items) => solveWith(items)
});

tool.draw('polyline'); // or 'point', 'line', 'nurbs'
```

While a mode is on, the tool claims canvas clicks ahead of object selection:

- **Click** places a point on the model's XY plane. A vertex of the model or of a drawn item under
  the cursor wins; `settings.planar` (on by default) drops it onto the plane.
- **Type** a length, or `length<angle`, and press Enter for an exact segment. **Shift** locks the
  direction to 45° steps. `settings.gridStep` rounds free points to a grid.
- **Click the first point** to close a polyline; click the last point again, or press Enter, to
  finish. Backspace removes the last point, Esc drops the item, then leaves the mode.
- `tool.move()` picks a vertex up with one click and puts it down with the next; Delete removes it.
- `tool.undo()` and `tool.redo()`, or Ctrl+Z and Ctrl+Shift+Z while a mode is on.
- Every straight segment shows its length. Click a label to type a new one: the segment's end
  moves along it and the rest of the curve follows.

`maxItems` caps what the input holds: one more drops the oldest and the mode ends at the count.

The items are host-owned scene content (`viewer.addUserGeometry`), so they survive solves. Call
`tool.dispose()` before the viewer disposes.

## Extending it

**Your own draw mode.** A mode turns placed points into items. Pass one to `draw` to add a shape
the built-ins lack, or to tag what is drawn with a path and attributes:

```ts
import type { DrawModeSpec } from '@selvajs/sketch/tool';

const rectangle: DrawModeSpec = {
	id: 'rectangle',
	pointCount: 2, // finishes by itself after two clicks
	build: ([a, b]) =>
		b
			? [
					{
						kind: 'polyline',
						closed: true,
						points: [a, [b[0], a[1], 0], b, [a[0], b[1], 0]],
						attributes: { role: 'slab' }
					}
				]
			: null
};
tool.draw(rectangle);
```

`build` is also called for the preview, with the cursor as the last point. `DRAW_MODES` holds the
four built-ins in the same form.

**Your own tool.** `createSketchTool` is two halves put together, both exported:

- `createCurveLayer`: what is shown. Curves (one colour each through `colorOf`), grab points, a
  preview, the cursor marker and labels, editable on click when given `onEdit`.
- `createPointPicker`: where a click lands. `pick(event, options)` gives a model point with the
  snaps, grid, angle lock and typed length applied; `nearestPoint` and `nearestCurve` hit-test for
  selection.

Register a `PointerTool` with the viewer, call the picker from it and the layer from your own
state, and the result snaps and looks like the built-in tool.
