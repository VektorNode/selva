# @selvajs/shared

Shared Svelte components, utilities, and theme system for Selva applications.

## Installation

```bash
pnpm add @selvajs/shared
```

Peer dependencies required: `svelte ^5`, `@sveltejs/kit ^2`, `bits-ui ^2`, `tailwind-variants ^3`, `@selvajs/compute ^1`

## Usage

```svelte
<script lang="ts">
	import { Button, Card, Input } from '@selvajs/shared';
</script>
```

```typescript
import { cn, debounce, themeStore } from '@selvajs/shared';
```

## Styles

In your `app.css`:

```css
@import '@selvajs/shared/styles/base.css';
```

Themes are available under `@selvajs/shared/styles/themes/*`.

## Generated Types

```typescript
import type { UISchema } from '@selvajs/shared';
```

Types are generated from `packages/schemas/ui-schema.json`. After modifying the schema, run:

```bash
cd packages/schemas && pnpm run generate:all
```

cd packages/shared && pnpm publish --no-git-checks
