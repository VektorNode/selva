<script lang="ts">
  import * as Accordion from '$lib/components/ui/accordion/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as Checkbox from '$lib/components/ui/checkbox/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  import { TreeBuilder, type DataTree, type InputParam } from '@selva/core/grasshopper';
  import {  } from '@selva/core';

  interface Props {
    input: InputParam[];
    onChange: (tree: DataTree[]) => void;
    headerText?: string;
    customStyles?: string;
  }

  let { input, onChange, headerText = '', customStyles = '' }: Props = $props();

  // Simple state object
  let values = $state<Record<string, any>>({});

  // Initialize values
  $effect(() => {
    values = input.reduce(
      (acc: Record<string, any>, param: InputParam) => {
        acc[param.name] = param.default ?? '';
        return acc;
      },
      {} as Record<string, any>
    );
  });

  // Convert to DataTree and notify parent of changes
  $effect(() => {
    let tree: any[] = [];
    Object.entries(values).forEach(([key, value]) => {
      tree = TreeBuilder.replaceTreeValue(tree, key, value);
    });
    onChange(tree);
  });

  // Parse nested group names (e.g., "Geometry::Dimensions" -> just "Dimensions")
  const parseGroupName = (fullName: string): string => {
    const parts = fullName.split('::');
    return parts[parts.length - 1] || fullName;
  };

  // Group inputs by groupName for accordion
  const getGroupedInputs = () => {
    const groups: Record<string, InputParam[]> = {};

    input.forEach((param: InputParam) => {
      const fullGroupName = param.groupName ?? 'General';
      const displayName = parseGroupName(fullGroupName);

      if (!groups[displayName]) {
        groups[displayName] = [];
      }
      groups[displayName].push(param);
    });

    return groups;
  };

const isVisible = (param: InputParam) => {
  const g = param.groupName?.toLowerCase();
  return g !== 'hide' && g !== 'hidden';
};
</script>

<div class="parameter-panel {customStyles}">
  {#if headerText}
    <header class="panel-header">
      <h2>{headerText}</h2>
    </header>
  {/if}

  <main class="panel-content">
    <div class="scrollable-content">
      <Accordion.Root type="multiple" value={Object.keys(getGroupedInputs())}>
  {#each Object.entries(getGroupedInputs()) as [groupName, params]}
    {#if params.some(p => isVisible(p))}
          <Accordion.Item value={groupName}>
            <Accordion.Trigger>{groupName}</Accordion.Trigger>
            <Accordion.Content>
              <div class="input-group">
                {#each params as param (param.name)}
                  {#if isVisible(param)}
                    <div class="input-field">
                      <Label for={param.name}>{param.name}</Label>
                      {#if param.paramType === 'Number' || param.paramType === 'Integer'}
                        <Input
                          id={param.name}
                          type="number"
                          value={values[param.name] ?? param.default ?? ''}
                          min={param.minimum}
                          max={param.maximum}
                          step={param.paramType === 'Integer' ? 1 : 0.01}
                          onchange={(e) => {
                            values = { ...values, [param.name]: parseFloat(e.currentTarget.value) };
                          }}
                        />
                      {:else if param.paramType === 'Boolean'}
                        <Checkbox.Root
                          checked={values[param.name] ?? param.default ?? false}
                          onCheckedChange={(checked) => {
                            values = { ...values, [param.name]: checked };
                          }}
                        />
                      {:else if param.paramType === 'Text'}
                        <Input
                          id={param.name}
                          type="text"
                          value={values[param.name] ?? param.default ?? ''}
                          onchange={(e) => {
                            values = { ...values, [param.name]: e.currentTarget.value };
                          }}
                        />
                      {:else if param.paramType === 'ValueList'}
                        <Select.Root
                          type="single"
                          value={values[param.name] ?? param.default ?? ''}
                          onValueChange={(value: string) => {
                            if (value) values = { ...values, [param.name]: value };
                          }}
                        >
                          <Select.Trigger class="w-full">
                            {values[param.name] ?? param.default ?? 'Select'}
                          </Select.Trigger>
                          <Select.Content>
                            {#each Object.keys(param.values ?? {}) as key (key)}
                              <Select.Item value={key} label={key}>{key}</Select.Item>
                            {/each}
                          </Select.Content>
                        </Select.Root>
                      {/if}
                    </div>
                  {/if}
                {/each}
              </div>
            </Accordion.Content>
          </Accordion.Item>
    {/if}
  {/each}
      </Accordion.Root>
    </div>
  </main>
</div>

<style>
  .parameter-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .panel-header {
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid hsl(var(--border));
  }

  .panel-header h2 {
    font-size: 1.25rem;
    font-weight: 700;
    color: hsl(var(--foreground));
    margin: 0;
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

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 0.75rem 0;
  }

  .input-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Enhance accordion trigger (group headers) */
  :global(.parameter-panel [data-accordion-trigger]) {
    font-weight: 600;
    font-size: 0.9375rem;
  }

  :global(.parameter-panel [data-accordion-trigger][data-state="open"]) {
    font-weight: 700;
  }

  /* Make parameter labels smaller and secondary */
  :global(.parameter-panel label) {
    font-size: 0.8125rem;
    font-weight: 500;
    color: hsl(215, 13%, 50%);
  }
</style>
