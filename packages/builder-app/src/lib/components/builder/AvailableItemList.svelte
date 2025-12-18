<script lang="ts">
  import type {
    DiscoveredInput,
    DiscoveredOutput,
    GrasshopperParamType,
    TabConfig,
  } from '@selva/shared';
  import { StateDisplay, Input, Select } from '@selva/shared';
  import DraggableItem from './DraggableItem.svelte';
  import { Search, X } from '@lucide/svelte';

  interface AvailableItemListProps {
    items: (DiscoveredInput | DiscoveredOutput)[];
    title: string;
    placedIds?: Set<string>;
    emptyMessage?: string;
    tabs?: TabConfig[];
    onAddToGroup?: (
      tabId: string,
      groupId: string,
      item: DiscoveredInput | DiscoveredOutput
    ) => void;
    onAddToNewGroup?: (path: string, item: DiscoveredInput | DiscoveredOutput) => void;
  }

  let {
    items,
    title,
    placedIds = new Set(),
    emptyMessage = 'No items found.',
    tabs = [],
    onAddToGroup,
    onAddToNewGroup,
  }: AvailableItemListProps = $props();

  let searchQuery = $state('');
  let selectedType = $state<GrasshopperParamType | 'all' | string>('all');

  const isParameter = (item: DiscoveredInput | DiscoveredOutput): item is DiscoveredInput => {
    return 'name' in item;
  };

  const availableTypes = $derived.by(() => {
    const types = new Set<GrasshopperParamType | string>();
    items.forEach((item) => {
      if (isParameter(item)) {
        types.add(item.type);
      } else {
        types.add(item.type);
      }
    });
    return Array.from(types).sort();
  });

  const availableItems = $derived(items.filter((i) => !placedIds.has(i.id)));

  const filteredItems = $derived.by(() => {
    let filtered = availableItems;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        const nickname = item.nickname?.toLowerCase() || '';
        const description = 'description' in item ? item.description?.toLowerCase() || '' : '';
        return nickname.includes(query) || description.includes(query);
      });
    }

    if (selectedType !== 'all') {
      filtered = filtered.filter((item) => {
        return item.type === selectedType;
      });
    }

    return filtered;
  });

  const clearSearch = () => {
    searchQuery = '';
  };
</script>

<div class="mb-6">
  <h3 class="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
    {title} ({availableItems.length})
  </h3>

  {#if availableItems.length > 0}
    <div class="mb-3 flex flex-col gap-2">
      <div class="relative">
        <Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search by name or description..."
          bind:value={searchQuery}
          class="pl-9 pr-9"
        />
        {#if searchQuery}
          <button
            type="button"
            onclick={clearSearch}
            class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X class="size-4" />
          </button>
        {/if}
      </div>

      {#if availableTypes.length > 1}
        <Select.Root
          type="single"
          value={selectedType}
          onValueChange={(value) => {
            if (value) selectedType = value;
          }}
        >
          <Select.Trigger class="w-full">
            {selectedType === 'all' ? 'All types' : selectedType}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all" label="All types" />
            {#each availableTypes as type (type)}
              <Select.Item value={type} label={type} />
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}
    </div>
  {/if}

  {#if filteredItems.length === 0}
    <StateDisplay
      type="empty"
      size="small"
      message={searchQuery || selectedType !== 'all'
        ? 'No items match your filters.'
        : emptyMessage}
    />
  {:else}
    <div class="flex flex-col gap-0 max-h-[600px] overflow-y-auto">
      {#each filteredItems as item (item.id)}
        <DraggableItem {item} {tabs} {onAddToGroup} {onAddToNewGroup} />
      {/each}
    </div>
  {/if}
</div>
