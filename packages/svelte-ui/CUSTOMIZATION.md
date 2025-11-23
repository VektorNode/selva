# Customization Guide

This guide explains how to customize the UI components in this library.

## Component Customization with Snippets

All input parameter components (`NumberParam`, `TextParam`, `BoolParam`, `ValueListParam`) support custom rendering through the `customInput` snippet prop.

### Basic Example

```svelte
<script>
  import { NumberParam } from '@computebuilder/svelte-ui';

  let myInput = {
    name: 'Width',
    paramType: 'Number',
    description: 'Width in mm',
    default: 100,
    minimum: 0,
    maximum: 500,
  };

  let value = $state(100);
</script>

<!-- Default rendering -->
<NumberParam input={myInput} bind:value />

<!-- Custom rendering -->
<NumberParam input={myInput} bind:value>
  {#snippet customInput({ value, onUpdate, input })}
    <div class="my-custom-input">
      <input type="number" {value} oninput={(e) => onUpdate(parseFloat(e.currentTarget.value))} />
      <span class="unit">mm</span>
    </div>
  {/snippet}
</NumberParam>
```

### Number Parameter Customization

The `NumberParam` component provides additional validation information:

```svelte
<NumberParam input={myInput} bind:value>
  {#snippet customInput({ value, onUpdate, input, validation })}
    <div class="custom-number-input">
      <input
        type="range"
        min={input.minimum}
        max={input.maximum}
        {value}
        oninput={(e) => onUpdate(parseFloat(e.currentTarget.value))}
      />
      <span class="value-display">{value}</span>

      {#if validation && !validation.isValid}
        <div class="error">{validation.warning}</div>
      {/if}
    </div>
  {/snippet}
</NumberParam>
```

### Boolean Parameter Customization

```svelte
<BoolParam input={myInput} bind:value>
  {#snippet customInput({ value, onUpdate, input })}
    <label class="toggle">
      <input type="checkbox" checked={value} onchange={(e) => onUpdate(e.currentTarget.checked)} />
      <span>{input.name}</span>
    </label>
  {/snippet}
</BoolParam>
```

### Text Parameter Customization

```svelte
<TextParam input={myInput} bind:value>
  {#snippet customInput({ value, onUpdate, input })}
    <textarea
      {value}
      oninput={(e) => onUpdate(e.currentTarget.value)}
      placeholder={input.description}
      rows="3"
    />
  {/snippet}
</TextParam>
```

### Value List (Dropdown) Customization

```svelte
<ValueListParam input={myInput} bind:value>
  {#snippet customInput({ value, onUpdate, input })}
    <div class="button-group">
      {#each Object.entries(input.values) as [label, val]}
        <button class:active={value === val} onclick={() => onUpdate(val)}>
          {label}
        </button>
      {/each}
    </div>
  {/snippet}
</ValueListParam>
```

## InputHandler Customization

The `InputHandler` component accepts several props for customization:

```svelte
<InputHandler
  bind:input={myInputs}
  onChange={(tree) => console.log('Values changed:', tree)}
  headerText="Configuration Panel"
  customStyles="max-width: 600px; margin: 0 auto;"
  autoUpdate={true}
  showSliders={true}
  showRangeIndicator={true}
  useNestedGroups={true}
>
  <!-- Optional children slot for custom controls -->
  <div class="custom-controls">
    <button onclick={() => resetAll()}>Reset All</button>
    <button onclick={() => saveConfig()}>Save</button>
  </div>
</InputHandler>
```

### Props Explanation

- **`input`** (bindable): Array of input parameters. Changes to nested values are reactive.
- **`onChange`**: Callback that receives the full DataTree when values change.
- **`autoUpdate`**: If true, `onChange` is called automatically on every value change.
- **`headerText`**: Optional header text displayed at the top.
- **`customStyles`**: CSS classes or inline styles for the container.
- **`showSliders`**: Show slider controls for numeric inputs (when min/max defined).
- **`showRangeIndicator`**: Show the valid range below numeric inputs.
- **`useNestedGroups`**: Enable nested accordion groups (auto-detects `::` in group names).

## Reactivity Best Practices

### ✅ Do This (Simple & Reactive)

```svelte
<script>
  let inputs = $state([
    { name: 'Width', paramType: 'Number', default: 100, ... }
  ]);
</script>

<InputHandler bind:input={inputs} onChange={handleChange} />
```

Changes to `inputs[0].default` will automatically trigger reactivity.

### ❌ Don't Do This (Unnecessary Complexity)

```svelte
<script>
  // Don't manually clone or track versions
  let inputs = structuredClone(originalInputs); // ❌
  let version = $state(0); // ❌

  function updateInput(name, value) {
    // Don't manually update and trigger reactivity
    const input = inputs.find((i) => i.name === name);
    input.default = value;
    version++; // ❌
  }
</script>
```

The library handles all reactivity automatically through Svelte 5's fine-grained reactivity system.

## Styling

All components use CSS custom properties for theming. Override them in your global styles:

```css
:root {
  --rh-color-primary: #3b82f6;
  --rh-color-text: #1f2937;
  --rh-typography-label-font-size: 0.875rem;
  --rh-spacing-label-margin: 0.5rem;
}
```

Alternatively, use the `customStyles` prop or wrap components in your own containers with custom classes.
