<script lang="ts">
  import { Panel } from '$lib/components/layout';
  import { Button } from '$lib/components/ui';
  import { SchemaInfoPanel, AvailableItemList } from '$lib/components/builder';
  import type {
    UISchema,
    AvailableParameter,
    AvailableOutput,
    TabConfig,
  } from '$lib/types/generated';

  interface Props {
    schema: UISchema;
    availableInputs: AvailableParameter[];
    availableOutputs: AvailableOutput[];
    placedIds: Set<string>;
    syncNeeded?: boolean;
    onSchemaChange: (schema: UISchema) => void;
    onSync: () => void;
    onAddToGroup: (tabId: string, groupId: string, item: AvailableParameter | AvailableOutput) => void;
    onAddToNewGroup: (path: string, item: AvailableParameter | AvailableOutput) => void;
  }

  let {
    schema,
    availableInputs,
    availableOutputs,
    placedIds,
    syncNeeded = false,
    onSchemaChange,
    onSync,
    onAddToGroup,
    onAddToNewGroup,
  }: Props = $props();
</script>

<aside class="flex flex-col gap-6">
  <SchemaInfoPanel {schema} onSchemaChange={onSchemaChange} />

  <Panel title="Available Parameters">
    {#snippet headerActions()}
      {#if syncNeeded}
        <Button variant="default" size="sm" onclick={onSync} class="bg-amber-500 hover:bg-amber-600">
          Sync
        </Button>
      {/if}
    {/snippet}
    <p class="mb-4 text-sm text-accent-foreground/40">
      Drag parameters into groups below or use the context menu to add them to specific
      tabs/groups.
    </p>

    <AvailableItemList
      items={availableInputs}
      title="Inputs"
      {placedIds}
      tabs={schema?.layout?.tabs || []}
      {onAddToGroup}
      {onAddToNewGroup}
    />

    <AvailableItemList
      items={availableOutputs}
      title="Outputs"
      {placedIds}
      tabs={schema?.layout?.tabs || []}
      {onAddToGroup}
      {onAddToNewGroup}
    />
  </Panel>
</aside>
