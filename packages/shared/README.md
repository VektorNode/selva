# @selva/shared

Shared Svelte components, utilities, and theme system used by both `@selva/builder-app` and `@selva/compute-app`.

## Components

Reusable UI components built with Shadcn:

- **Button** — Primary, secondary, destructive variants
- **Card** — Layout with header, content, footer
- **AlertDialog** — Confirmation dialogs
- **Input** — Text, number, file inputs
- **Select** — Dropdown selection
- **Checkbox** — Toggleable checkbox
- **Badge** — Status badges
- **Tabs** — Tab navigation
- **Dialog** — Modal dialogs
- **Tooltip** — Hover tooltips
- **Spinner** — Loading indicators

## Usage

```svelte
<script lang="ts">
  import { Button, Card, AlertDialog } from '@selva/shared';
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>My Card</Card.Title>
  </Card.Header>
  <Card.Content>
    <Button onclick={() => console.log('clicked')}>
      Click me
    </Button>
  </Card.Content>
</Card.Root>
```

## Theme System

Built-in light/dark mode with CSS variables:

```svelte
<script>
  import { themeStore } from '@selva/shared';
</script>

<!-- Toggle theme -->
<button onclick={() => $themeStore.toggleTheme()}>
  {$themeStore.isDark ? '🌙' : '☀️'}
</button>
```

**Available colors:**
- `foreground` — Text color
- `background` — Page background
- `muted` — Secondary text/backgrounds
- `accent` — Highlights and interactive elements
- `destructive` — Error states
- `success` — Success states

## Utilities

Helper functions for common tasks:

```typescript
import {
  cn,           // Merge Tailwind classes
  formatDate,   // Format dates
  parseJSON,    // Safe JSON parsing
  debounce,     // Debounce functions
} from '@selva/shared';
```

## Build

```bash
pnpm install
pnpm run build:shared
```

## Generated Types

TypeScript types are auto-generated from `packages/schemas/ui-schema.json`:

```typescript
import type { User, Project } from '@selva/shared/src/lib/types/generated/schema';
```

After modifying the schema, run:

```bash
cd packages/schemas && npm run generate:all
```

## Related

- [`@selva/builder-app`](../builder-app) — Uses components for UI designer
- [`@selva/compute-app`](../compute-app) — Uses components for solver UI
- [`@selva/schemas`](../schemas) — Generates types used here
