<script lang="ts">
	import type { Component } from 'svelte';
	import { ChevronDown } from '@lucide/svelte';
	import { cn } from '#lib/utils.js';
	import { buttonVariants } from './button';
	import * as Popover from './popover';
	import * as Command from './command';

	export interface FilterableDropdownItem {
		id: string;
		label: string;
		icon?: Component;
		iconClass?: string;
	}

	interface Props {
		items: FilterableDropdownItem[];
		value: string | null | undefined;
		onChange: (id: string) => void;
		id?: string;
		placeholder?: string;
		triggerIcon?: Component;
		searchPlaceholder?: string;
		/** Above this many items the list gets a filter box. */
		searchThreshold?: number;
		disabled?: boolean;
		class?: string;
	}

	let {
		items,
		value,
		onChange,
		id,
		placeholder = 'Select...',
		triggerIcon: TriggerIcon,
		searchPlaceholder = 'Filter...',
		searchThreshold = 4,
		disabled = false,
		class: className
	}: Props = $props();

	let open = $state(false);

	const selected = $derived(items.find((item) => item.id === value) ?? null);
	const SelectedIcon = $derived(selected?.icon ?? TriggerIcon);

	function pick(item: FilterableDropdownItem) {
		onChange(item.id);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		{id}
		{disabled}
		role="combobox"
		aria-expanded={open}
		class={cn(
			buttonVariants({ variant: 'outline' }),
			'font-normal w-full justify-start',
			className
		)}
	>
		{#if SelectedIcon}
			<SelectedIcon class={cn('size-3.5', selected?.iconClass ?? 'text-muted-foreground')} />
		{/if}
		<span class={cn('min-w-0 flex-1 truncate text-left', !selected && 'text-muted-foreground')}>
			{selected ? selected.label : placeholder}
		</span>
		<ChevronDown class="size-3.5 text-muted-foreground" />
	</Popover.Trigger>
	<Popover.Content align="start" class="p-0 w-(--bits-popover-anchor-width)">
		<Command.Root>
			{#if items.length > searchThreshold}
				<Command.Input placeholder={searchPlaceholder} />
			{/if}
			<Command.List>
				<Command.Empty>No matches.</Command.Empty>
				{#each items as item (item.id)}
					{@const ItemIcon = item.icon}
					<!-- Filter on the label; the id is only the key. -->
					<Command.Item
						value={item.id}
						keywords={[item.label]}
						data-checked={item.id === value}
						onSelect={() => pick(item)}
					>
						{#if ItemIcon}
							<ItemIcon class={cn('size-3.5', item.iconClass ?? 'text-muted-foreground')} />
						{/if}
						<span class="truncate">{item.label}</span>
					</Command.Item>
				{/each}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
