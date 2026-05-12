# @selvajs/ui

Shared Svelte components, utilities, and theme system for Selva applications.

pnpm publish --access public --no-git-checks

## Installation

```bash
pnpm add @selvajs/ui
```

Peer dependencies required: `svelte ^5`, `@sveltejs/kit ^2`, `bits-ui ^2`, `tailwind-variants ^3`, `@selvajs/compute ^1`

## Usage

```svelte
<script lang="ts">
	import { Button, Card, Input } from '@selvajs/ui';
</script>
```

```typescript
import { cn, debounce, themeStore } from '@selvajs/ui';
```

## Styles

In your `app.css`:

```css
@import '@selvajs/ui/styles/base.css';
```

Themes are available under `@selvajs/ui/styles/themes/*`.

## Generated Types

```typescript
import type { UISchema } from '@selvajs/ui';
```

Types are generated from `packages/schemas/ui-schema.json`. After modifying the schema, run:

```bash
cd packages/schemas && pnpm run generate:all
```
