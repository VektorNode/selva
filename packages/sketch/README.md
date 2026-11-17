# @selvajs/sketch

Lines, polylines and NURBS curves as Grasshopper inputs: draw them in a
[`@selvajs/visualization`](../visualization) viewer, import them from DXF or 3DM, and encode them
so Rhino.Compute reads them through a stock Get Line or Get Geometry.

Three entrypoints, no root entry. Each layer imports only the ones above it in this table.

| Entry    | Holds                                                          | Needs                             |
| -------- | -------------------------------------------------------------- | --------------------------------- |
| `/model` | Curve types, NURBS evaluation, lengths, edits                  | nothing                           |
| `/io`    | DXF reader, Rhino archive codec, 3DM reader                    | `rhino3dm` for the Rhino parts    |
| `/tool`  | The draw tool: snaps, typed lengths, editable dimension labels | `three`, `@selvajs/visualization` |

## Curves

```ts
import { nurbsFromControlPoints, type SketchCurve } from '@selvajs/sketch/model';

const curves: SketchCurve[] = [
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

## Sending curves to Rhino.Compute

A Get Line input takes plain JSON. A Get Geometry input takes Rhino's archive JSON, which only
rhino3dm writes, so those functions take the loaded module:

```ts
import rhino3dm from 'rhino3dm';
import { encodeCurve, decodeCurve, lineToRhinoJson } from '@selvajs/sketch/io';

const rhino = await rhino3dm();
const geometryValue = curves.map((curve) => encodeCurve(rhino, curve)); // Get Geometry
const lineValue = [lineToRhinoJson(curves[0])]; // Get Line
```

Pass either list as the input's value to `TreeBuilder.fromValues` (`@selvajs/compute`): each item
becomes one item of branch `{0}`. `decodeCurve` reads any Rhino curve back; arcs, circles and
polycurves come back as NURBS.

## Importing

```ts
import { parseDxf, read3dm } from '@selvajs/sketch/io';

const dxf = parseDxf(await file.text());
const model = read3dm(rhino, new Uint8Array(await file.arrayBuffer()));
```

Both return curves in the file's own units with `metersPerUnit` (null when the file states none),
and report what they skipped.

DXF reads LINE, LWPOLYLINE, POLYLINE, SPLINE, ARC and CIRCLE from the ENTITIES section. Arcs and
bulged polyline segments become exact rational NURBS, not tessellated polylines. Block references
(INSERT), ELLIPSE, fit-point-only splines and binary DXF are not read.

## Drawing in a viewer

```ts
import { createSketchTool } from '@selvajs/sketch/tool';

const tool = createSketchTool({
	viewer, // ThreeViewer from initThree
	id: 'outline',
	metersPerUnit: 0.001, // the scene is in metres; this model is in millimetres
	unitSuffix: 'mm',
	onChange: (curves) => solveWith(curves)
});

tool.draw('polyline'); // or 'line', 'nurbs'
```

While a mode is on, the tool claims canvas clicks ahead of object selection:

- **Click** places a point on the model's XY plane. A vertex of the model or of a drawn curve under
  the cursor wins; `settings.planar` (on by default) drops it onto the plane.
- **Type** a length, or `length<angle`, and press Enter for an exact segment. **Shift** locks the
  direction to 45° steps. `settings.gridStep` rounds free points to a grid.
- **Click the first point** to close a polyline; click the last point again, or press Enter, to
  finish. Backspace removes the last point, Esc drops the curve, then leaves the mode.
- `tool.move()` picks a vertex up with one click and puts it down with the next; Delete removes it.
- Every straight segment shows its length. Click a label to type a new one: the segment's end
  moves along it and the rest of the curve follows.

The curves are host-owned scene content (`viewer.addUserGeometry`), so they survive solves. Call
`tool.dispose()` before the viewer disposes.
