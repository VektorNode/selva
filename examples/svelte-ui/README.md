# @selva/svelte-ui

A Svelte 5 component library for building interactive UIs for Grasshopper definitions. Auto-generates form controls from `@selva/core` parameters with built-in validation, type safety, and layout customization.

## Overview

Production-ready components that integrate with `@selva/core` to create dynamic interfaces. Handles input validation, type constraints, data tree management, and provides customizable UI controls.

## Features

- **Auto-Generated UI** — Create form controls from Grasshopper parameters automatically
- **Type-Safe** — Full TypeScript with discriminated unions from `@selva/core`
- **Input Validation** — Built-in validation, clamping for numeric inputs
- **Data Trees** — Native support for Grasshopper's hierarchical data structures
- **Multiple Types** — Number, Integer, Text, Boolean, Point parameters
- **Flexible Layouts** — Accordion grouping with customizable styling
- **Error Handling** — Display warnings and compute errors
- **Customizable** — Override components, customize display options
- **Dark Mode** — Built-in support

## Installation

```bash
npm install @selva/svelte-ui @selva/core
```

## Quick Start

```svelte
<script lang="ts">
  import { GrasshopperClient } from '@selva/core';
  import { InputHandler } from '@selva/svelte-ui';

  const client = new GrasshopperClient({
    serverUrl: 'https://compute.rhino3d.com',
  });

  const { inputs } = await client.getIO('https://example.com/definition.gh');

  async function handleSolve(values) {
    const result = await client.solve('https://example.com/definition.gh', values);
    console.log(result.data);
  }
</script>

<InputHandler
  {inputs}
  onChange={handleSolve}
  headerText="Parameters"
  autoUpdate={true}
/>
```

## Main Component

### InputHandler

Auto-generates form controls for all Grasshopper parameters:

```svelte
<InputHandler
  input={grasshopperInputs}
  onChange={handleChange}
  headerText="Parameters"
  autoUpdate={true}
  displayOptions={{
    darkMode: false,
    showSliders: true,
    accordionSeparated: true,
  }}
/>
```

**Props:**
- `input` — Array of Grasshopper parameters
- `onChange` — Callback when values change (ready for `client.solve()`)
- `autoUpdate` — Auto-trigger onChange on changes
- `headerText` — Section header
- `displayOptions` — Styling: `darkMode`, `showSliders`, `accordionSeparated`, etc.
- `customComponents` — Override specific parameter type components

### MessageOverlay

Display errors, warnings, and compute messages:

```svelte
<MessageOverlay
  errorMessage={null}
  warnings={[]}
  computeErrors={[]}
  showMessages={true}
  onShowMessagesToggle={(show) => { /* ... */ }}
  onDismissMessage={(type, index) => { /* ... */ }}
  onClearAllMessages={() => { /* ... */ }}
/>
```

## Additional Components

Individual parameter components for custom layouts:
- **NumberParam**, **TextParam**, **BoolParam**, **PointParam** — Single parameters
- **Accordion** — Collapsible groups

All components export TypeScript types from `@selva/core` for full type safety.

## Customization

**Custom styling:**
```svelte
<InputHandler input={inputs} onChange={handleChange} customStyles="my-style" />
```

**Dark mode:**
```svelte
<InputHandler input={inputs} onChange={handleChange} displayOptions={{ darkMode: true }} />
```

**Override components:**
```svelte
<InputHandler input={inputs} onChange={handleChange}
  customComponents={{ Number: MyCustomSlider }} />
```

## Requirements

- Svelte 5.0+
- `@selva/core` (exports all types)
- TypeScript 5.0+ (recommended)

## Related Packages

- [`@selva/core`](../core) — Type-safe Rhino Compute client
- [`@selva/frontend`](../builder) — Full UI builder application with WebSocket support

## License

[MIT](./LICENSE.md)
