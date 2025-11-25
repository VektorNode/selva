<script lang="ts">
  import NestedAccordion from './components/NestedAccordion.svelte';

  import * as Accordion from '$lib/components/ui/accordion/index.js';
  import Input from '$lib/components/ui/input/input.svelte';
  import * as Checkbox from '$lib/components/ui/checkbox/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Slider from '$lib/components/ui/slider/index.js';

  import { type InputParam, type NestedGroupNode } from '@selva/core/grasshopper';

  import { untrack } from 'svelte';
  import {
    groupedInputsToDataTrees,
    groupInputs,
    groupInputsNested,
  } from './utils/input-grouping.js';

  interface Props {
    input: InputParam[];
    onChange: (tree: any[]) => void;
    headerText?: string;
    customStyles?: string;
    autoUpdate?: boolean;
    children?: any;
    showSliders?: boolean;
    showRangeIndicator?: boolean;
    useNestedGroups?: boolean;
  }

  let props: Props = $props();

  // Reactive array with tracked nested mutations
  let input = $state(props.input);

  // Auto-detect nested structure based on "::"
  let useNested = $derived(props.useNestedGroups || input.some((p) => p.groupName?.includes('::')));

  // Single grouping source
  let groups = $derived(useNested ? groupInputsNested(input) : groupInputs(input));

  // Reactive tree
  let dataTree = $derived(groupedInputsToDataTrees(groupInputs(input)));

  // Auto-propagate input changes
  $effect(() => {
    untrack(() => props.onChange(dataTree));
  });

  const isVisible = (p: InputParam) => {
    const g = p.groupName?.toLowerCase();
    return g !== 'hide' && g !== 'hidden';
  };
</script>

<div class="parameter-panel {props.customStyles}">
  {#if props.headerText}
    <header class="panel-header">
      <h2>{props.headerText}</h2>
    </header>
  {/if}

  <main class="panel-content">
    <div class="scrollable-content">
      {#if useNested}
        <!-- Nested mode -->
        {@const rootNodes = Object.values(groups) as NestedGroupNode[]}

        <div class="nested-accordion-container">
          {#each rootNodes as root (root.path)}
            <NestedAccordion node={root} defaultOpen={true}>
              {#snippet nodeChildren(node)}
                <div class="input-group">
                  {#each node.inputs as param (param.name)}
                    {#if isVisible(param)}
                      {@const i = input.findIndex((x) => x.name === param.name)}
                      <div class="input-field">
                        <label>{param.name}</label>
                        {@render renderInput(param, i)}
                      </div>
                    {/if}
                  {/each}
                </div>
              {/snippet}
            </NestedAccordion>
          {/each}
        </div>
      {:else}
        <!-- Flat mode -->
        <Accordion.Root type="multiple" value={Object.keys(groups)}>
          {#each Object.entries(groups) as [groupName, group]}
            <Accordion.Item value={groupName}>
              <Accordion.Trigger>{groupName}</Accordion.Trigger>

              <Accordion.Content>
                <div class="input-group">
                  {#each group.inputs as param (param.name)}
                    {#if isVisible(param)}
                      {@const i = input.findIndex((x) => x.name === param.name)}
                      <div class="input-field">
                        <label>{param.name}</label>
                        {@render renderInput(param, i)}
                      </div>
                    {/if}
                  {/each}
                </div>
              </Accordion.Content>
            </Accordion.Item>
          {/each}
        </Accordion.Root>
      {/if}
    </div>

    {#if props.children}
      <div class="children-container">
        {@render props.children()}
      </div>
    {/if}
  </main>
</div>

<!-- Unified input rendering -->
{#snippet renderInput(param: InputParam, index: number)}
  {#if param.paramType === 'Number' || param.paramType === 'Integer'}
    {#if props.showSliders && param.minimum != null && param.maximum != null}
      <Slider.Root
        type="single"
        value={input[index].default as number}
        min={param.minimum}
        max={param.maximum}
        step={param.paramType === 'Integer' ? 1 : 0.01}
        onValueChange={(v) => (input[index].default = v)}
      />
    {/if}

    <Input
      type="number"
      value={input[index].default}
      min={param.minimum}
      max={param.maximum}
      step={param.paramType === 'Integer' ? 1 : 0.01}
      oninput={(e) => (input[index].default = parseFloat(e.currentTarget.value))}
    />
  {:else if param.paramType === 'Boolean'}
    <Checkbox.Root
      checked={input[index].default as boolean}
      onCheckedChange={(v) => (input[index].default = v === true)}
    />
  {:else if param.paramType === 'Text'}
    <Input
      type="text"
      value={input[index].default}
      oninput={(e) => (input[index].default = e.currentTarget.value)}
    />
  {:else if param.paramType === 'ValueList'}
    <Select.Root
      type="single"
      value={input[index].default as string}
      onValueChange={(v) => v && (input[index].default = v)}
    >
      <Select.Trigger class="w-full">
        {Object.entries(param.values || {}).find(([, v]) => v === input[index].default)?.[0] ||
          'Select'}
      </Select.Trigger>

      <Select.Content>
        {#each Object.entries(param.values || {}) as [label, val] (val)}
          <Select.Item value={val} {label}>{label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  {/if}
{/snippet}

<style>
  .parameter-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .panel-header {
    margin-bottom: 1rem;
  }

  .panel-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .panel-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .scrollable-content {
    flex: 1;
    overflow-y: auto;
    padding-right: 0.5rem;
  }

  .children-container {
    border-top: 1px solid #e5e7eb;
    padding: 1rem 0.5rem 0 0;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .input-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .input-field label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .nested-accordion-container {
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    overflow: hidden;
  }
</style>
