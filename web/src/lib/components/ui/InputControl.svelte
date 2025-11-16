<script lang="ts">
  import type { InputParameter } from "$lib/types/schema";
  import { debounce } from "$lib/utils/debounce";

  interface Props {
    input: InputParameter;
    value: any;
    displayName?: string;
    onChange: (parameterName: string, value: any) => void;
    debounceMs?: number;
  }

  let { input, value = $bindable(), displayName, onChange, debounceMs = 0 }: Props = $props();

  // Debounced handler for sliders
  const debouncedOnChange = debounce((val: any) => onChange(input.name, val), debounceMs);

  function handleChange(newValue: any) {
    value = newValue;
    if (debounceMs > 0) {
      debouncedOnChange(newValue);
    } else {
      onChange(input.name, newValue);
    }
  }
</script>

<div class="parameter-control">
  <label>
    {displayName || input.name}
    {#if input.tooltip}
      <span class="tooltip" title={input.tooltip}>ℹ️</span>
    {/if}
  </label>

  {#if input.type === "number"}
    <input
      type="number"
      value={value}
      min={input.config.min}
      max={input.config.max}
      step={input.config.step ?? 1}
      on:input={(e) => handleChange(parseFloat(e.currentTarget.value))}
    />
  {:else if input.type === "slider"}
    <div class="slider-control">
      <input
        type="range"
        value={value}
        min={input.config.min ?? 0}
        max={input.config.max ?? 100}
        step={input.config.step ?? 1}
        on:input={(e) => {
          // Update local value immediately for UI responsiveness
          value = parseFloat(e.currentTarget.value);
          // Debounce the actual update
          handleChange(parseFloat(e.currentTarget.value));
        }}
      />
      <span class="slider-value">{value}</span>
    </div>
  {:else if input.type === "checkbox"}
    <label class="checkbox-label">
      <input
        type="checkbox"
        checked={value}
        on:change={(e) => handleChange(e.currentTarget.checked)}
      />
      <span>Enabled</span>
    </label>
  {:else if input.type === "text"}
    <input
      type="text"
      value={value}
      placeholder={input.config.placeholder}
      on:input={(e) => handleChange(e.currentTarget.value)}
    />
  {:else if input.type === "color"}
    <div class="color-control">
      <input
        type="color"
        value={value}
        on:input={(e) => handleChange(e.currentTarget.value)}
      />
      <span class="color-value">{value}</span>
    </div>
  {:else if input.type === "dropdown"}
    <select
      value={value}
      on:change={(e) => handleChange(e.currentTarget.value)}
    >
      {#each input.config.options || [] as option}
        <option value={option}>{option}</option>
      {/each}
    </select>
  {/if}

  {#if input.description}
    <p class="parameter-description">
      {input.description}
    </p>
  {/if}
</div>

<style>
  .parameter-control {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    font-weight: 500;
    color: #24292e;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tooltip {
    cursor: help;
    font-size: 0.8rem;
    opacity: 0.6;
  }

  input[type="text"],
  input[type="number"],
  select {
    padding: 0.6rem;
    border: 1px solid #d1d5da;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.95rem;
    transition: border-color 0.2s;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: #0366d6;
    box-shadow: 0 0 0 3px rgba(3, 102, 214, 0.1);
  }

  input[type="range"] {
    width: 100%;
  }

  .slider-control,
  .color-control {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .slider-value,
  .color-value {
    min-width: 60px;
    font-family: monospace;
    font-size: 0.9rem;
    color: #586069;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
  }

  input[type="checkbox"] {
    width: 20px;
    height: 20px;
    cursor: pointer;
  }

  input[type="color"] {
    width: 80px;
    height: 40px;
    cursor: pointer;
    border: 1px solid #d1d5da;
    border-radius: 4px;
  }

  .parameter-description {
    font-size: 0.8rem;
    color: #586069;
    margin: 0;
    font-style: italic;
  }
</style>
