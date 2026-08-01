# @selvajs/ui

The Svelte layer over Selva's framework-free cores. Its npm surface is the **compute-app SDK**:
everything an external host app needs to embed a Grasshopper-driven app, drive solves, and wire
pre-step producers.

The design system (`Button`, `Card`, `Dialog`, `AppShell`, …) lives here too, but is **internal to
the monorepo** — it is reachable from the full barrel via the `@selvajs/source` export condition and
never ships to npm. [`src/lib/public.ts`](./src/lib/public.ts) is the authoritative list of what a
published consumer can import; promote a primitive there explicitly rather than assuming it is
available.

## Installation

```bash
pnpm add @selvajs/ui
```

Peer dependencies: `svelte ^5`, `@sveltejs/kit ^2`, `bits-ui ^2`, `tailwind-variants ^3`, plus the
Selva cores this package wraps — `@selvajs/compute`, `@selvajs/schemas`, `@selvajs/solve`, and
`@selvajs/visualization`.

`three` is an **optional** peer: install it only if you use `Viewer`, the part that wraps
`@selvajs/visualization`.

## Usage

Embed a whole Grasshopper-driven app:

```svelte
<script lang="ts">
	import { ComputeApp } from '@selvajs/ui';
</script>
```

Or render meshes on their own, outside a `ComputeApp` host:

```svelte
<script lang="ts">
	import { Viewer, type ViewerConfig } from '@selvajs/ui';
</script>
```

To drive a solve session yourself rather than letting `ComputeApp` own it:

```typescript
import { useSolveSession } from '@selvajs/ui';
```

The session itself lives in `@selvajs/solve/client` and is framework-free. Inside a Svelte
component always use `useSolveSession` — the raw `createSolveSession` factory returns correct
values that never re-render.

## Styles

In your `app.css`:

```css
@import '@selvajs/ui/styles/base.css';
```

Themes are available under `@selvajs/ui/styles/themes/*` — `selva`, `neutral`, `ocean`, and
`cyberpunk`.

## Schema types

Types generated from `packages/schemas/ui-schema.json` are published by `@selvajs/schemas`, not
re-exported here:

```typescript
import type { SelvaUISchema } from '@selvajs/schemas';
```

After modifying the schema, run:

```bash
cd packages/schemas && pnpm run generate
```
