# Building a viewer app

An app that lives _inside_ the viewer, drawing on top of solve results rather than in a stage
before them. A point cloud you upload and keep on screen, a line tool whose output feeds
Grasshopper, an annotation layer.

Nothing here requires forking this package. Everything is runtime API on the `ThreeViewer` handle.

## The three seams

| You want to                          | Use                                     |
| ------------------------------------ | --------------------------------------- |
| Put your own geometry in the scene   | `viewer.addUserGeometry(obj, appId)`    |
| Claim clicks before object selection | `viewer.tools.register(...)`            |
| Attach text to a 3D position         | `viewer.labelLayer.addLabel(text, pos)` |

Plus one thing that is not optional: **call `viewer.invalidate()` after you touch the scene.** The
render loop is on-demand. Geometry you add without it is in the scene and invisible until something
else triggers a repaint.

## Getting the handle

`initThree` returns it. Inside a Svelte host, `<Viewer>` and `<ComputeApp>` hand it over via
`onViewerReady`, whose return value is a cleanup function:

```ts
<ComputeApp
  onViewerReady={(viewer) => {
    const app = startMyApp(viewer);
    return () => app.dispose();   // runs before the viewer disposes
  }}
/>
```

`onViewerReady` fires once per mounted viewer. `AppLayout` renders separate mobile and desktop
viewers, so switching between them tears one down (your cleanup runs) and builds another (you get
called again with a new handle). Don't cache the handle in module scope.

## Owning scene content

```ts
viewer.addUserGeometry(pointCloud, 'cloud'); // userData.source = 'app:cloud'
viewer.invalidate();
```

What the `appId` buys you:

- **It survives solves.** `clearScene` replaces everything tagged `compute` on every solve and
  spares anything host-owned. Without this your content is destroyed the first time the user moves
  a slider.
- **`clearUserGeometry('cloud')` clears yours alone.** Two apps in one viewer don't clobber each
  other. Calling it with no id clears every host-owned object, which is rarely what you want.

Omitting the id tags the object `'user'` instead. It still survives solves, but only a global clear
removes it; prefer an id.

Three consequences worth knowing up front:

- **`setLook` skips your geometry.** Switching render style retunes solve output only; your
  materials are yours. If you _want_ to follow the look, read `viewer.getMaterialAppearance()`.
- **The scene outliner lists it.** Users can hide and select it like any other object. That's
  usually right. Hidden state is keyed on `userData.id`, so set a stable one if it should outlive a
  solve; without it the key falls back to the instance uuid and resets whenever you rebuild.
- **Fit-to-view frames it.** It counts as content, so a stray far-off object will wreck framing.

## Writing a tool

A tool is any object with `handleClick(event) => boolean`. Returning `true` means _I consumed this_:
dispatch stops and object selection doesn't run. Everything else on the interface is optional:

```ts
interface PointerTool {
	handleClick(event: MouseEvent): boolean;
	handleMove?(event: MouseEvent): void; // never consumes
	setEnabled?(enabled: boolean): void;
	isEnabled?(): boolean;
	clear?(): void;
	dispose?(): void;
}
```

Register it and make it active:

```ts
const off = viewer.tools.register({ id: 'draw', tool: myTool, priority: 10 });
viewer.tools.setActive('draw'); // enables 'draw', disables every other registered tool
```

**`setActive` is not optional if your tool implements `setEnabled`.** A tool that starts disabled
and is never activated silently ignores every click, the most common way to wire this up wrong.

`priority` orders dispatch, highest first. The built-ins are `'measure'` at 0 and `'gizmo'` at
−100, so register above 0 to claim clicks before measuring, below −100 to act as a fallback.
Registering an id twice replaces the earlier tool.

`register` returns an unregister function. It does **not** dispose your tool: you still own it:

```ts
return () => {
	off();
	myTool.dispose();
};
```

### What the host already handles

- **Drag rejection.** Releasing an orbit drag fires a `click`. Anything past 5px of travel is
  dropped before your tool sees it, so a released orbit never places a vertex.
- **Capture phase.** Tools run before bubble-phase selection, which is why returning `true` is
  enough to suppress it.
- **Moves reach every tool** regardless of who consumed the last click, and never consume. Preview
  freely; you cannot break orbit or pan from `handleMove`.

### Picking

Don't hand-roll the grab band; use the same primitives the built-in tools do, or your tool will
feel different at the same zoom:

```ts
import { pickThreshold, snapToVertex, pointerToNdc } from '@selvajs/visualization/render';

const camera = viewer.cameraController.getActiveCamera();
raycaster.setFromCamera(pointerToNdc(event, canvas), camera);

// Constant on-screen grab band regardless of framing. Pass the orbit target or it
// falls back to distance-from-origin and misjudges off-origin content.
const threshold = pickThreshold(camera, viewer.controls.target);
raycaster.params.Line = { threshold };
raycaster.params.Points = { threshold };

const hit = raycaster.intersectObjects(viewer.scene.children, true)[0];
// Snaps to a real vertex within N screen px of the hit, else returns the raw point.
const point = snapToVertex(hit, camera, { width, height }, 12);
```

Two things this naive version gets wrong that yours shouldn't:

- **Filter out your own preview geometry**, or clicks near your rubber band snap to the band
  instead of the model under it. Walk `object.parent` checking for your own `userData.source`:
  hits report leaf objects, not the group you added.
- **`intersectObjects` is O(n) per event.** Fine against solve meshes; far too slow against a
  multi-million-point cloud on every `mousemove`. Bring a spatial index for that case.

## Driving solves

`ComputeApp`'s `onReady` hands you the live session:

```ts
<ComputeApp
  onReady={({ getSession }) => { session = getSession(); }}
  onViewerReady={(viewer) => { /* … */ }}
/>
```

Then your tool's output becomes a solve input like any other:

```ts
onCommit: (points) => session.setValue(paramId, JSON.stringify(encode(points)));
```

Safe to call at interaction rate: solves are single-in-flight, latest-wins, with the previous one
aborted, and a repeat of an already-solved input set is served from a memo without a network round
trip. `setValue(id, value, true)` forces a solve even in manual-solve mode.

What you don't get: **solves are whole-scene.** Every solve sends the complete input set and
replaces all compute content. You can steer _what_ you send (one polyline, a batch, all of them),
but results don't composite. Solving line 6 alone removes the mesh for lines 1–5. Either include
everything each time, or hold results as your own app geometry where they're yours to manage.

## Checklist

- [ ] `appId` on every `addUserGeometry` call
- [ ] `viewer.invalidate()` after every scene mutation
- [ ] `setActive` once the tool should be live
- [ ] Cleanup returned from `onViewerReady`: unregister _and_ dispose
- [ ] Own preview geometry excluded from picking
- [ ] Stable `userData.id` if hide/select state should survive a solve
