# @selvajs/builder-app

Local schema designer for the Selva Grasshopper plugin. Runs only on the designer's machine alongside Rhino — not a deployable app.

## Routes

- `/builder` — drag-and-drop schema designer connected to Grasshopper via WebSocket
- `/preview` — live UI preview with real-time parameter control
- `/` — session management

## How it works

The plugin (`Selva.gha`) starts a WebSocket server on port 8765. The dev server connects to it, discovers Grasshopper parameters automatically, and persists the schema back into the `.gh` file. `/preview` re-renders on every parameter change.

## Development

```bash
pnpm install
pnpm run dev    # http://localhost:5173
```

No env vars required.

## Production

The builder-app is bundled and embedded into `Selva.gha` by `pnpm build:plugin` — the plugin serves the assets from a local HTTP port at runtime. There is no standalone deployment.

For the deployable app, see [@selvajs/compute-app](../compute-app/).

## Related

- [@selvajs/ui](../ui/) — shared Svelte components and theme
- [@selvajs/schemas](../schemas/) — schema generators
- [Selva.gha plugin](../../Plugin/) — Grasshopper bridge
