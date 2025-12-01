# @selva/web

SvelteKit web application for building and deploying Grasshopper UIs. Works in two modes: **local** (with Grasshopper via WebSocket) or **cloud** (standalone app with Rhino Compute integration).

## Two Deployment Modes

### Local Development Mode
When used with `Selva.gha` plugin in Grasshopper:

- **Routes:**
  - `/builder` — Drag-and-drop schema designer connected to Grasshopper via WebSocket
  - `/preview` — Real-time UI preview with live parameter control
  - `/` — Session management

- **How it works:**
  1. Plugin starts `Selva.gha` with LocalWebServer
  2. Web app connects via WebSocket (port 8765)
  3. Designer discovers Grasshopper parameters automatically
  4. User creates UI schema visually
  5. Schema persists to `.gh` file
  6. `/preview` shows live UI with real-time updates

### Cloud Deployment Mode
Standalone web app deployed independently (Vercel, Netlify, etc):

- **Routes:**
  - `/app` — Grasshopper solver interface using `@selva/core`
  - Uses generated schemas from `@selva/schemas`
  - Calls Rhino Compute servers via `@selva/core` client

- **How it works:**
  1. Generated schema embedded in build
  2. App runs as static site or SPA
  3. UI controls send parameter values to Rhino Compute
  4. Results streamed back and displayed

## Development

```bash
npm install
npm run dev           # http://localhost:5173 (dev server)
npm run start         # http://localhost:5173 (for use with Selva.gha)
npm run check         # Type checking
npm run build         # Production build
npm run preview       # Test production build
```

## Technology

- **SvelteKit 5** — Web framework with static adapter for local deployment
- **Vite** — Build system with hot reload
- **Three.js** — 3D geometry viewer
- **Tailwind CSS** — Styling

## Related

- [`@selva/core`](../core) — Rhino Compute client (used in cloud mode)
- [`@selva/svelte-ui`](../svelte-ui) — Component library used in UI builder
- [`@selva/schemas`](../schemas) — Schema generators (produces types for this app)
- [Selva.gha Plugin](../../Plugin) — Grasshopper bridge (used in local mode)
