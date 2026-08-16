# @selvajs/plugin-ui

UI for the Selva Grasshopper plugin — schema designer + preview. Embedded into `Selva.gha` and served from the plugin's local HTTP port at runtime; the dev server here is what the plugin connects to when iterating on the UI alongside Rhino. Not a standalone/deployable app.

## Routes

- `/builder` — drag-and-drop schema designer connected to Grasshopper via WebSocket
- `/preview` — live UI preview with real-time parameter control
- `/` — session management

## How it works

The plugin (`Selva.gha`) starts a WebSocket server on loopback — 8765 by default, or a free port if that's taken — and opens the UI with its actual port in the `wsPort` query param. The page connects back over that socket, discovers Grasshopper parameters, and persists the schema into the `.gh` file. `/preview` re-renders on every parameter change.

Every route needs a `session` query param; the root page refuses to proceed without one, since the session is what ties a browser tab to one UIBuilder component.

## Development

```bash
pnpm dev:plugin    # http://localhost:5173
```

No env vars — the WebSocket port arrives in the query string.

## Production

This package is built and embedded into `Selva.gha` by `pnpm build:plugin` — the plugin serves the assets from a local HTTP port at runtime. There is no standalone deployment.

For the deployable app, see [@selvajs/selva](../selva/).

## Related

- [@selvajs/ui](../ui/) — shared Svelte components and theme
- [@selvajs/schemas](../schemas/) — schema generators
- [Selva.gha plugin](../../Plugin/) — Grasshopper bridge
