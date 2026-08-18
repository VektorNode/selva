---
'@selvajs/ui': minor
---

Expose the edge overlay through `ViewerConfig`.

`Viewer` can already draw edge overlays on solved meshes, but nothing let a host
decide whether they start on. `ViewerConfig.showEdges` (optional, default `false`)
now sets the initial state of both the overlay and its display-menu checkmark, so
an embedder that wants edges visible on first paint no longer has to ship a
click.

```svelte
<Viewer config={{ showEdges: true }} />
```

The runtime toggle in the display menu is unchanged.
