<script lang="ts">
	import type { DiscoveredInput, DiscoveredOutput, TabConfig } from '@selvajs/schemas';
	import { ContextMenu, Input } from '@selvajs/ui';
	import { ArrowDownToLine, ArrowUpFromLine, FolderPlus, GripVertical } from '@lucide/svelte';

	interface Props {
		item: DiscoveredInput | DiscoveredOutput;
		tabs?: TabConfig[];
		onAddToGroup?: (
			tabId: string,
			groupId: string,
			item: DiscoveredInput | DiscoveredOutput
		) => void;
		onAddToNewGroup?: (path: string, item: DiscoveredInput | DiscoveredOutput) => void;
	}

	let { item, tabs = [], onAddToGroup, onAddToNewGroup }: Props = $props();

	let newGroupPath = $state('');

	const isInput = $derived('name' in item);
	const label = $derived(item.nickname || ('name' in item ? item.name : 'Unknown'));

	function handleAddToGroup(tabId: string, groupId: string) {
		onAddToGroup?.(tabId, groupId, item);
	}

	function handleAddToNewGroup() {
		if (newGroupPath.trim()) {
			onAddToNewGroup?.(newGroupPath.trim(), item);
			newGroupPath = '';
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleAddToNewGroup();
		}
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger>
		{#snippet child({ props })}
			<!-- Tag styling matches BuilderGroupItem so a parameter reads the same before and after it's placed.
			     While dragged, the row fills the clone, which svelte-dnd-action resizes to the slot under the
			     pointer: over a group it already has the placed card's size, so nothing grows on drop. -->
			<div
				{...props}
				tabindex="-1"
				role="button"
				title={item.description || undefined}
				class="group/param border-border bg-background hover:border-primary/50 flex h-9 cursor-grab items-center gap-2 rounded-lg border pr-2 pl-1 text-sm transition-colors active:cursor-grabbing [#dnd-action-dragged-el>&]:h-full"
			>
				<GripVertical
					size={14}
					class="text-muted-foreground/40 group-hover/param:text-muted-foreground shrink-0"
				/>
				<span class="text-foreground min-w-0 flex-1 truncate font-medium">{label}</span>
				{#if isInput}
					<span
						class="bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase"
					>
						<ArrowUpFromLine size={10} strokeWidth={2.5} />
						{item.type}
					</span>
				{:else}
					<span
						class="inline-flex shrink-0 items-center gap-1 rounded-sm bg-orange-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-orange-600 uppercase dark:text-orange-400"
					>
						<ArrowDownToLine size={10} strokeWidth={2.5} />
						{item.type || 'unknown'}
					</span>
				{/if}
			</div>
		{/snippet}
	</ContextMenu.Trigger>

	<ContextMenu.Content class="w-64">
		{#if tabs.length > 0}
			<ContextMenu.Group>
				<ContextMenu.GroupHeading>Add to Existing Group</ContextMenu.GroupHeading>
				{#each tabs as tab (tab.id)}
					{#if tab.groups.length > 0}
						<ContextMenu.Sub>
							<ContextMenu.SubTrigger>{tab.label}</ContextMenu.SubTrigger>
							<ContextMenu.SubContent>
								{#each tab.groups as group (group.id)}
									<ContextMenu.Item onclick={() => handleAddToGroup(tab.id, group.id)}>
										{group.label}
									</ContextMenu.Item>
								{/each}
							</ContextMenu.SubContent>
						</ContextMenu.Sub>
					{/if}
				{/each}
			</ContextMenu.Group>
			<ContextMenu.Separator />
		{/if}

		<ContextMenu.Group>
			<ContextMenu.GroupHeading>
				<div class="flex items-center gap-2">
					<FolderPlus class="size-4" />
					Create New Group
				</div>
			</ContextMenu.GroupHeading>
			<div class="px-2 py-1.5">
				<Input
					type="text"
					placeholder="Tab/Group or Group"
					bind:value={newGroupPath}
					onkeydown={handleKeydown}
					class="h-8 text-sm"
				/>
				<p class="text-muted-foreground mt-1 text-xs">Use "Tab/Group" to create in specific tab</p>
			</div>
			<ContextMenu.Item onclick={handleAddToNewGroup} disabled={!newGroupPath.trim()}>
				Add to New Group
			</ContextMenu.Item>
		</ContextMenu.Group>
	</ContextMenu.Content>
</ContextMenu.Root>
