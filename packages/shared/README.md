# selva-shared

Shared Svelte components, utilities, and theme system for Selva applications.

## Installation

```bash
pnpm add selva-shared
```

Peer dependencies required: `svelte ^5`, `@sveltejs/kit ^2`, `bits-ui ^2`, `tailwind-variants ^3`, `selva-compute ^1`

## Usage

```svelte
<script lang="ts">
	import { Button, Card, Input } from 'selva-shared';
</script>
```

```typescript
import { cn, debounce, themeStore } from 'selva-shared';
```

## Styles

In your `app.css`:

```css
@import 'selva-shared/styles/base.css';
```

Themes are available under `selva-shared/styles/themes/*`.

## Generated Types

```typescript
import type { UISchema } from 'selva-shared';
```

Types are generated from `packages/schemas/ui-schema.json`. After modifying the schema, run:

```bash
cd packages/schemas && pnpm run generate:all
```
