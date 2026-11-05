<script lang="ts">
	import type { TabConfig } from '@selvajs/schemas';
	import { Button, DropdownMenu } from '@selvajs/ui';
	import { builderSelection } from '#lib/features/builder/selection.svelte.js';
	import { X } from '@lucide/svelte';
	import { untrack } from 'svelte';

	interface Props {
		tabs: TabConfig[];
		/** Parameters already on the canvas; they left the sidebar, so they leave the selection. */
		placedParamIds: ReadonlySet<string>;
		onAdd: (groupId: string) => void;
		onMove: (groupId: string) => void;
	}

	let { tabs, placedParamIds, onAdd, onMove }: Props = $props();

	const placing = $derived(builderSelection.params.size > 0);
	const count = $derived(builderSelection.count);
	const withGroups = $derived(tabs.filter((tab) => tab.groups.length > 0));

	// Undo, a removed card or a single drag can take a selected row away; drop it from the count.
	$effect(() => {
		const itemIds = new Set(tabs.flatMap((t) => t.groups.flatMap((g) => g.items.map((i) => i.id))));
		const placedParams = placedParamIds;
		untrack(() =>
			builderSelection.prune(
				(id) => !placedParams.has(id),
				(id) => itemIds.has(id)
			)
		);
	});
</script>

<!-- Shift held: rows show a pointer and a dashed outline, the cue that a click now selects. Blur clears it, since the
     keyup never arrives when focus leaves the window mid-press. -->
<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Shift') document.documentElement.classList.add('shift-select');
		if (e.key === 'Escape' && count > 0) builderSelection.clear();
	}}
	onkeyup={(e) => {
		if (e.key === 'Shift') document.documentElement.classList.remove('shift-select');
	}}
	onblur={() => document.documentElement.classList.remove('shift-select')}
/>

{#if count > 0}
	<div
		role="toolbar"
		aria-label="Selection"
		class="bg-card border-border-strong shadow-popover fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border p-1.5 pl-3 text-sm"
	>
		<span class="font-medium tabular-nums">{count} selected</span>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} size="sm" disabled={withGroups.length === 0}>
						{placing ? 'Add to group' : 'Move to group'}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="top" align="center" sideOffset={8} class="min-w-52">
				{#each withGroups as tab, i (tab.id)}
					{#if i > 0}<DropdownMenu.Separator />{/if}
					<DropdownMenu.Label>{tab.label}</DropdownMenu.Label>
					{#each tab.groups as group (group.id)}
						<DropdownMenu.Item onSelect={() => (placing ? onAdd(group.id) : onMove(group.id))}>
							{group.label}
						</DropdownMenu.Item>
					{/each}
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Clear selection"
			onclick={builderSelection.clear}
		>
			<X />
		</Button>
	</div>
{/if}

<style>
	:global(html.shift-select [data-select-row]),
	:global(html.shift-select [data-select-row] [role='button']) {
		cursor: pointer !important;
	}
	/* The hovered row shows what a shift-click would pick: the whole card on the canvas. */
	:global(html.shift-select [data-select-row]:not([data-builder-item-header]):hover),
	:global(html.shift-select [data-builder-item-id]:has([data-select-row]:hover)) {
		outline: 1px dashed var(--primary);
		outline-offset: 2px;
	}
</style>
