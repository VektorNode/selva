# Rhino Compute UI

A Svelte component library for building interactive user interfaces for Rhino Compute-powered
applications. Automatically generates type-safe, validated UI controls for Grasshopper parameters.

## Overview

This package provides production-ready Svelte 5 components that integrate seamlessly with
`rhino-compute-core` to create dynamic, responsive interfaces for Grasshopper definitions. It
handles input validation, type constraints, data tree management, and provides customizable UI
controls out of the box.

## Features

- **Auto-Generated UI** - Automatically create form controls from Grasshopper parameter definitions
- **Type-Safe Components** - Full TypeScript support with discriminated union types
- **Input Validation** - Built-in validation and clamping for numeric inputs with min/max
  constraints
- **Data Tree Support** - Native support for Grasshopper's hierarchical data structures
- **Multiple Parameter Types** - Number, Integer, Text, Boolean, and Point parameters
- **Flexible Layouts** - Accordion-based grouping with customizable styling
- **Error Handling** - Built-in overlay component for displaying warnings and compute errors
- **Customizable** - Custom component overrides and extensive display options
- **Dark Mode** - Built-in dark mode support
- **Slider Controls** - Optional slider inputs with automatic step sizing

## Installation

```bash
npm install rhino-compute-ui rhino-compute-core svelte
```

## Quick Start

```svelte
<script lang="ts">
  import { GrasshopperClient } from 'rhino-compute-core';
  import { InputHandler } from 'rhino-compute-ui';

  const client = new GrasshopperClient({
    serverUrl: 'https://compute.rhino3d.com',
  });

  // Fetch Grasshopper definition inputs
  const { inputs } = await client.getIO('https://example.com/definition.gh');

  async function handleInputChange(trees: DataTree[]) {
    // Trees are in DataTree format ready for rhino-compute-core
    const result = await client.solve('https://example.com/definition.gh', trees);
    console.log(result.data);
  }
</script>

<InputHandler
  input={inputs}
  onChange={handleInputChange}
  headerText="My Grasshopper Definition"
  autoUpdate={true}
/>
```

## Core Components

### InputHandler

The main component that automatically generates UI controls for all Grasshopper parameters.

```svelte
<InputHandler
  input={grasshopperInputs}
  onChange={handleChange}
  headerText="Parameters"
  customStyles="my-custom-class"
  autoUpdate={true}
  customComponents={{
    Number: MyCustomNumberComponent,
  }}
  displayOptions={{
    darkMode: false,
    showSliders: true,
    hideHeader: false,
    showRangeIndicator: true,
    accordionSeparated: true,
    accordionHeaderColor: '#f0f0f0',
    accordionBackgroundColor: '#ffffff',
  }}
/>
```

**Props:**

| Prop               | Type                         | Description                            |
| ------------------ | ---------------------------- | -------------------------------------- |
| `input`            | `InputParam[]`               | Array of Grasshopper input parameters  |
| `onChange`         | `(tree: DataTree[]) => void` | Callback fired when inputs change      |
| `headerText`       | `string`                     | Optional header text                   |
| `customStyles`     | `string`                     | Custom CSS classes                     |
| `autoUpdate`       | `boolean`                    | Auto-trigger onChange on input changes |
| `customComponents` | `Record<string, any>`        | Override default components by type    |
| `displayOptions`   | `DisplayOptions`             | Visual customization options           |

**Display Options:**

- `darkMode` - Enable dark mode styling
- `showSliders` - Show slider controls for numeric inputs
- `hideHeader` - Hide the header section
- `showRangeIndicator` - Display min/max range indicators
- `accordionSeparated` - Add visual separation between accordion sections
- `accordionHeaderColor` - Custom header background color
- `accordionBackgroundColor` - Custom content background color

### MessageOverlay

Component for displaying errors, warnings, and compute messages.

```svelte
<script lang="ts">
  import { MessageOverlay } from 'rhino-compute-ui';

  let errorMessage = $state(null);
  let warnings = $state([]);
  let computeErrors = $state([]);
  let showMessages = $state(true);
</script>

<MessageOverlay
  {errorMessage}
  {warnings}
  {computeErrors}
  {showMessages}
  onShowMessagesToggle={(show) => (showMessages = show)}
  onDismissMessage={(type, index) => {
    if (type === 'error') errorMessage = null;
    if (type === 'warning') warnings = warnings.filter((_, i) => i !== index);
  }}
  onClearAllMessages={() => {
    errorMessage = null;
    warnings = [];
    computeErrors = [];
  }}
/>
```

## Parameter Components

Individual parameter components for custom implementations:

### NumberParam

Handles Number and Integer parameter types with validation.

```svelte
<script lang="ts">
  import { NumberParam } from 'rhino-compute-ui';

  let numberInput = {
    paramType: 'Number',
    name: 'Radius',
    minimum: 0,
    maximum: 100,
    default: 50,
  };
</script>

<NumberParam input={numberInput} bind:value={numberInput.default} showSlider={true} />
```

### TextParam

Handles text string inputs.

```svelte
<script lang="ts">
  import { TextParam } from 'rhino-compute-ui';

  let textInput = {
    paramType: 'Text',
    name: 'Label',
    default: 'Hello',
  };
</script>

<TextParam input={textInput} bind:value={textInput.default} />
```

### BoolParam

Handles boolean toggle inputs.

```svelte
<script lang="ts">
  import { BoolParam } from 'rhino-compute-ui';

  let boolInput = {
    paramType: 'Boolean',
    name: 'Enable',
    default: true,
  };
</script>

<BoolParam input={boolInput} bind:value={boolInput.default} />
```

### PointParam

Handles 3D point inputs with X, Y, Z coordinates.

```svelte
<script lang="ts">
  import { PointParam } from 'rhino-compute-ui';

  let pointInput = {
    paramType: 'Point',
    name: 'Location',
    default: [0, 0, 0],
  };
</script>

<PointParam input={pointInput} bind:value={pointInput.default} />
```

### Accordion

Collapsible section container for organizing parameters.

```svelte
<script lang="ts">
  import { Accordion } from 'rhino-compute-ui';

  const items = [
    { id: 'geometry', title: 'Geometry', disabled: false },
    { id: 'settings', title: 'Settings', disabled: false },
  ];
</script>

<Accordion
  {items}
  allowMultiple={true}
  defaultOpen={['geometry', 'settings']}
  darkMode={false}
  separated={true}
>
  {#snippet children(item)}
    <div>Content for {item.title}</div>
  {/snippet}
</Accordion>
```

## Utility Functions

### Validation

```typescript
import { validateNumber, getSliderConfig } from 'rhino-compute-ui';

// Validate and clamp numeric input
const result = validateNumber(userInput, grasshopperInput);
if (!result.isValid) {
  console.warn(result.warningMessage);
  console.log('Clamped value:', result.clampedValue);
}

// Get slider configuration from input
const config = getSliderConfig(grasshopperInput);
// Returns: { min: number, max: number, step: number }
```

### Value Helpers

```typescript
import { isDataTree, updateValue, getValue, getValueEntries } from 'rhino-compute-ui';

// Check if value is a DataTree
if (isDataTree(value)) {
  console.log('This is a data tree structure');
}

// Update values in arrays or data trees
const updated = updateValue(currentValue, newValue, index, branch);

// Get specific value from array or data tree
const value = getValue(dataStructure, index, branch);

// Get all entries for iteration
const entries = getValueEntries(dataStructure);
entries.forEach((entry) => {
  console.log(entry.value, entry.index, entry.branch);
});
```

## Advanced Usage

### Custom Component Override

Replace default components with your own:

```svelte
<script lang="ts">
  import { InputHandler } from 'rhino-compute-ui';
  import MyCustomSlider from './MyCustomSlider.svelte';

  const customComponents = {
    Number: MyCustomSlider,
  };
</script>

<InputHandler input={inputs} onChange={handleChange} {customComponents} />
```

### Grouped Parameters

Parameters are automatically grouped by their `groupName` property from Grasshopper:

```typescript
// In Grasshopper, set input group names:
// - Geometry
// - Settings
// - Advanced

// InputHandler automatically creates accordion sections
```

Hide parameters by setting their group name to "hide" or "hidden" in Grasshopper.

### Data Tree Integration

The component automatically handles Grasshopper's data tree structures:

```typescript
// Single values become {0} branch
default: 5
// → { "{0}": [5] }

// Arrays are preserved
default: [1, 2, 3]
// → { "{0}": [1, 2, 3] }

// Explicit tree paths
default: {
  "{0}": [1, 2, 3],
  "{1}": [4, 5, 6]
}
```

### Full Example with Error Handling

```svelte
<script lang="ts">
  import { GrasshopperClient } from 'rhino-compute-core';
  import { InputHandler, MessageOverlay } from 'rhino-compute-ui';

  const client = new GrasshopperClient({
    serverUrl: 'http://localhost:8081',
  });

  let inputs = $state([]);
  let errorMessage = $state(null);
  let warnings = $state([]);
  let computeErrors = $state([]);
  let showMessages = $state(true);

  // Load definition
  const definitionUrl = 'https://example.com/definition.gh';

  async function loadDefinition() {
    try {
      const { inputs: ghInputs } = await client.getDefinitionIO(definitionUrl);
      inputs = ghInputs;
    } catch (error) {
      errorMessage = error.message;
    }
  }

  async function handleInputChange(trees) {
    try {
      const result = await client.solve(definitionUrl, trees);

      if (result.warnings) {
        warnings = result.warnings;
      }

      if (result.errors) {
        computeErrors = result.errors;
      }

      // Process result.data...
    } catch (error) {
      errorMessage = error.message;
    }
  }

  loadDefinition();
</script>

<div class="container">
  <InputHandler
    input={inputs}
    onChange={handleInputChange}
    headerText="Grasshopper Definition"
    autoUpdate={true}
    displayOptions={{
      showSliders: true,
      accordionSeparated: true,
    }}
  />

  <MessageOverlay
    {errorMessage}
    {warnings}
    {computeErrors}
    {showMessages}
    onShowMessagesToggle={(show) => (showMessages = show)}
    onDismissMessage={(type, index) => {
      if (type === 'error') errorMessage = null;
      if (type === 'warning') warnings.splice(index, 1);
      if (type === 'computeError') computeErrors.splice(index, 1);
    }}
    onClearAllMessages={() => {
      errorMessage = null;
      warnings = [];
      computeErrors = [];
    }}
  />
</div>
```

## Styling

The components use scoped styles but can be customized:

### Custom Styles

```svelte
<InputHandler input={inputs} onChange={handleChange} customStyles="my-custom-panel" />

<style>
  :global(.my-custom-panel) {
    background: #f5f5f5;
    border-radius: 8px;
    padding: 1rem;
  }

  :global(.my-custom-panel .input-field label) {
    color: #333;
    font-weight: 600;
  }
</style>
```

### Dark Mode

```svelte
<InputHandler input={inputs} onChange={handleChange} displayOptions={{ darkMode: true }} />
```

## Browser Support

- Modern browsers with ES2020 support
- Chrome 80+
- Firefox 75+
- Safari 13.1+
- Edge 80+

## TypeScript Support

Full TypeScript definitions included. The library exports all types from `rhino-compute-core`:

```typescript
import type {
  InputParam,
  NumericInputType,
  TextInputType,
  BooleanInputType,
  PointInputType,
  DataTree,
} from 'rhino-compute-core/grasshopper';

import type { ValidationResult } from 'rhino-compute-ui';
```

## Related Packages

- **[rhino-compute-core](https://www.npmjs.com/package/rhino-compute-core)** - Core TypeScript
  client for Rhino Compute
- **[@compuceraptor](https://github.com/TheVessen/compuceraptor)** - Grasshopper plugin with helper
  components for display and file export

## Requirements

- Svelte 5.0+
- rhino-compute-core 1.0+
- TypeScript 5.0+ (recommended)

## License

[MIT](./LICENSE.md)
