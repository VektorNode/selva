<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import { Button, StateDisplay } from '$lib/components/ui';
  import { EditableTabNav, EditableGroup, BuilderGroupItem } from '$lib/components/builder';
  import type { TabConfig, AvailableParameter } from '$lib/types/generated';

  interface Props {
    tabs: TabConfig[];
    activeTabId: string | null;
    onTabChange: (tabId: string) => void;
    onAddTab: () => void;
    onRemoveTab: (tabId: string) => void;
    onReorderTabs: (fromIndex: number, toIndex: number) => void;
    onAddGroup: (tabId: string) => void;
    onRemoveGroup: (tabId: string, groupId: string) => void;
    onParameterDrop: (tabId: string, groupId: string, event: CustomEvent) => void;
    onReorder: (event: CustomEvent) => void;
    onRemoveItem: (tabId: string, groupId: string, itemId: string) => void;
    getParameterInfo: (paramId: string) => AvailableParameter | undefined;
  }

  let {
    tabs = $bindable(),
    activeTabId,
    onTabChange,
    onAddTab,
    onRemoveTab,
    onReorderTabs,
    onAddGroup,
    onRemoveGroup,
    onParameterDrop,
    onReorder,
    onRemoveItem,
    getParameterInfo,
  }: Props = $props();

  const activeTab = $derived(tabs.find((t) => t.id === activeTabId));
</script>

<Card.Root class="shadow-sm">
  <Card.Header class="flex flex-row items-center justify-between space-y-0">
    <div></div>
    <Button onclick={onAddTab}>+ Add Tab</Button>
  </Card.Header>
  <Card.Content>
    <div class="min-h-[200px]">
      {#if !tabs || tabs.length === 0}
        <StateDisplay
          type="empty"
          size="large"
          title="No tabs yet"
          message="Click 'Add Tab' to create your first tab"
        />
      {:else}
        <!-- Tab Navigation -->
        <EditableTabNav
          {tabs}
          {activeTabId}
          onTabChange={onTabChange}
          onRemoveTab={onRemoveTab}
          onReorderTabs={onReorderTabs}
        />

        <!-- Active Tab Content -->
        {#if activeTab}
          <div class="animate-[fadeIn_0.2s]">
            <div class="mb-6 flex justify-end">
              <Button variant="outline" onclick={() => onAddGroup(activeTab.id)}>
                + Add Group
              </Button>
            </div>

            {#if activeTab.groups.length === 0}
              <StateDisplay
                type="empty"
                size="medium"
                message="No groups yet. Click 'Add Group' to organize your parameters."
              />
            {:else}
              <div class="flex flex-col gap-6">
                {#each activeTab.groups as group, groupIndex (group.id)}
                  <EditableGroup
                    bind:group={activeTab.groups[groupIndex]}
                    onDrop={(e) => onParameterDrop(activeTab.id, group.id, e)}
                    {onReorder}
                    onRemove={() => onRemoveGroup(activeTab.id, group.id)}
                  >
                    {#each group.items as item (item.id)}
                      {@const paramInfo = getParameterInfo(item.paramId)}
                      <BuilderGroupItem
                        {item}
                        {paramInfo}
                        tabId={activeTab.id}
                        groupId={group.id}
                        onRemove={() => onRemoveItem(activeTab.id, group.id, item.id)}
                      />
                    {/each}
                  </EditableGroup>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </Card.Content>
</Card.Root>
