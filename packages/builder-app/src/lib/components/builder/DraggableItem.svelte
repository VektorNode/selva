<script lang="ts">
	import { dragStore } from '$lib/stores/dragStore.svelte';
	import type { DiscoveredInput, DiscoveredOutput, TabConfig } from '@selvajs/ui';
	import { ContextMenu, Input } from '@selvajs/ui';
	import { FolderPlus } from '@lucide/svelte';

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

	// Infer variant from item type
	const variant = $derived('name' in item ? 'input' : 'output');

	let isDragging = $state(false);

	function handleDragStart(e: DragEvent) {
		isDragging = true;

		dragStore.set({
			dropType: variant,
			data: item
		});

		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'copy';
			e.dataTransfer.setData('text/plain', item.id);
		}
	}

	function handleDragEnd() {
		isDragging = false;
		dragStore.clear();
	}

	const badgeContent = $derived(
		'name' in item ? item.type : (item as DiscoveredOutput).type || 'Unknown'
	);

	// Variant-based styling
	const styles = $derived({
		input: {
			bg: 'bg-inputparam',
			badgeBg: 'bg-primary/10',
			badgeText: 'text-primary'
		},
		output: {
			bg: 'bg-outputparam',
			badgeBg: 'bg-primary/10',
			badgeText: 'text-primary'
		}
	});
	const style = $derived(styles[variant]);

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
		<div
			tabindex="-1"
			class={`
        border-ring/50 hover:border-primary hover:bg-muted mb-2 flex
        cursor-grab flex-row items-center justify-between gap-4
        rounded-xl border p-3
        transition-all ${style.bg}
        ${isDragging ? 'cursor-grabbing opacity-50' : ''}
      `}
			draggable="true"
			role="button"
			ondragstart={handleDragStart}
			ondragend={handleDragEnd}
		>
			<div class="flex flex-1 items-center gap-3">
				<strong class="text-foreground"
					>{item.nickname || ('name' in item ? item.name : 'Unknown')}</strong
				>
				<span class={`rounded px-2 py-1 text-sm ${style.badgeBg} ${style.badgeText}`}>
					{badgeContent}
				</span>
			</div>
			<span class="text-muted-foreground cursor-grab font-bold select-none">⋮⋮</span>
		</div>
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
