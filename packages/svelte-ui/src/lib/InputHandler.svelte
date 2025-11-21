<script lang="ts">
  import NumberParam from './components/input-params/NumberParam.svelte';
  import BoolParam from './components/input-params/BoolParam.svelte';
  import Accordion from './components/Accordion.svelte';
  import NestedAccordion from './components/NestedAccordion.svelte';
  import TextParam from './components/input-params/TextParam.svelte';
  import PointParam from './components/input-params/PointParam.svelte';
  import ValueListParam from './components/input-params/ValueListParam.svelte';
  import {
    groupedInputsToDataTrees,
    groupInputs,
    groupInputsNested,
    type DataTree,
    type InputParam,
    type NestedGroupNode,
  } from '@computebuilder/core/grasshopper';
  import { type Snippet } from 'svelte';

  interface Props {
    input: InputParam[];
    onChange: (tree: DataTree[]) => void;
    headerText?: string;
    customStyles?: string;
    autoUpdate?: boolean;
    children?: Snippet;
    showSliders?: boolean;
    showRangeIndicator?: boolean;
    useNestedGroups?: boolean;
  }

  let {
    input: inputProp,
    onChange,
    headerText,
    customStyles = '',
    autoUpdate = false,
    children,
    showSliders = false,
    showRangeIndicator = true,
    useNestedGroups = false,
  }: Props = $props();

  // Make inputs reactive - deep clone to ensure reactivity on value changes
  let input = $state<InputParam[]>(structuredClone(inputProp));

  // Update input when prop changes
  $effect(() => {
    input = structuredClone(inputProp);
  });

  // Track a version number to force reactivity when input values change
  let inputVersion = $state(0);

  // Handler to update input value and trigger reactivity
  const handleValueChange = (inputName: string, newValue: any) => {
    const inputToUpdate = input.find((inp) => inp.name === inputName);
    if (inputToUpdate) {
      inputToUpdate.default = newValue;
      inputVersion++;
    }
  };

  // Get reactive reference to input by name from source array
  const getInputByName = (inputName: string) => {
    return input.find((inp) => inp.name === inputName);
  };

  // Detect if input contains nested groups (using :: separator)
  const hasNestedGroups = $derived(
    input.some((inp) => inp.groupName && inp.groupName.includes('::'))
  );

  // Auto-detect or use explicit flag
  const shouldUseNestedGroups = $derived(useNestedGroups || hasNestedGroups);

  // Group inputs based on nested vs flat mode - use $derived for reactive grouping
  const groupedInputs = $derived(shouldUseNestedGroups ? {} : groupInputs(input));
  const nestedGroupedInputs = $derived(shouldUseNestedGroups ? groupInputsNested(input) : {});

  // Component mapping with custom overrides
  const getComponent = (paramType: string) => {
    const defaultMap: Record<string, any> = {
      Number: NumberParam,
      Integer: NumberParam,
      Text: TextParam,
      Boolean: BoolParam,
      Point: PointParam,
      ValueList: ValueListParam,
    };
    return defaultMap[paramType];
  };

  // Build tree from ALL inputs - derived from input array and version
  // The inputVersion dependency ensures this recalculates when values change
  const currentTree = $derived.by(() => {
    // Access inputVersion to create dependency
    inputVersion;
    return groupedInputsToDataTrees(groupInputs(input));
  });

  // Check if input should be visible
  const isVisible = (inputParam: InputParam): boolean => {
    const groupName = inputParam.groupName?.toLowerCase();
    return groupName !== 'hide' && groupName !== 'hidden';
  };

  // Accordion items derived from groups
  const accordionItems = $derived(
    Object.keys(groupedInputs).map((key) => ({
      id: key,
      title: key,
      disabled: false,
    }))
  );

  // Handle initial mount and auto-updates with a single effect
  $effect(() => {
    // Auto-update: call onChange whenever currentTree changes
    if (autoUpdate) {
      onChange(currentTree);
    }
  });
</script>

<div class="parameter-panel {customStyles}">
  {#if headerText}
    <header class="panel-header">
      <h2>{headerText}</h2>
    </header>
  {/if}

  <main class="panel-content">
    <div class="scrollable-content">
      {#if shouldUseNestedGroups}
        {@const rootNodes = Object.values(nestedGroupedInputs) as NestedGroupNode[]}
        <!-- Nested accordion structure -->
        <div class="nested-accordion-container">
          {#each rootNodes as rootNode (rootNode.path)}
            <NestedAccordion node={rootNode} defaultOpen={true}>
              {#snippet nodeChildren(node)}
                <div class="input-group">
                  {#each node.inputs as inputParam (inputParam.name)}
                    {#if isVisible(inputParam)}
                      {@const Component = getComponent(inputParam.paramType)}
                      {@const sourceInput = getInputByName(inputParam.name)}
                      <div class="input-field">
                        <label for={inputParam.name}>{inputParam.name}</label>
                        {#if Component && sourceInput}
                          <Component
                            input={inputParam}
                            bind:value={sourceInput.default}
                            showSlider={showSliders}
                            showRange={showRangeIndicator}
                            onchange={handleValueChange}
                          />
                        {/if}
                      </div>
                    {/if}
                  {/each}
                </div>
              {/snippet}
            </NestedAccordion>
          {/each}
        </div>
      {:else}
        <!-- Flat accordion structure -->
        <Accordion
          items={accordionItems}
          allowMultiple={true}
          defaultOpen={groupedInputs ? Object.keys(groupedInputs) : []}
        >
          {#snippet accordionChildren(item)}
            {@const group = groupedInputs[item.id]}
            {#if group}
              <div class="input-group">
                {#each group.inputs as inputParam (inputParam.name)}
                  {#if isVisible(inputParam)}
                    {@const Component = getComponent(inputParam.paramType)}
                    {@const sourceInput = getInputByName(inputParam.name)}
                    <div class="input-field">
                      <label for={inputParam.name}>{inputParam.name}</label>
                      {#if Component && sourceInput}
                        <Component
                          input={inputParam}
                          bind:value={sourceInput.default}
                          showSlider={showSliders}
                          showRange={showRangeIndicator}
                          onchange={handleValueChange}
                        />
                      {/if}
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          {/snippet}
        </Accordion>
      {/if}
    </div>

    {#if children}
      <div class="children-container">
        {@render children()}
      </div>
    {/if}
  </main>
</div>

<style>
  .parameter-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    width: 100%;
    overflow: hidden;
  }

  .panel-header {
    flex-shrink: 0;
    margin-bottom: 1rem;
  }

  .panel-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .panel-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .scrollable-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 0.5rem;
    min-height: 0;
  }

  .children-container {
    flex-shrink: 0;
    width: 100%;
    padding: 1rem 0.5rem 0 0;
    border-top: 1px solid #e5e7eb;
    background-color: white;
    box-sizing: border-box;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-bottom: 0.5rem;
  }

  .input-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .input-field label {
    display: block;
    font-size: var(--rh-typography-label-font-size, 0.875rem);
    font-weight: var(--rh-typography-label-font-weight, 500);
    color: var(--rh-color-text, inherit);
    margin-bottom: var(--rh-spacing-label-margin, 0.375rem);
  }

  .nested-accordion-container {
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    overflow: hidden;
  }
</style>
