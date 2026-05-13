<script lang="ts">
	import type { Component } from 'svelte';
	import { Search, ChevronDown, Check } from '@lucide/svelte';
	import { cn } from '$lib/utils.js';

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
	let query = $state('');
	let highlighted = $state(0);
	let inputRef = $state<HTMLInputElement>();
	let containerRef = $state<HTMLDivElement>();

	const selected = $derived(items.find((item) => item.id === value) ?? null);
	const showSearch = $derived(items.length > searchThreshold);

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return items;
		return items.filter((item) => item.label.toLowerCase().includes(q));
	});

	$effect(() => {
		void matches;
		highlighted = 0;
	});

	$effect(() => {
		if (open) {
			queueMicrotask(() => inputRef?.focus());
		} else {
			query = '';
		}
	});

	function pick(item: FilterableDropdownItem) {
		onChange(item.id);
		open = false;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlighted = Math.min(highlighted + 1, matches.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlighted = Math.max(highlighted - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const m = matches[highlighted];
			if (m) pick(m);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
		}
	}

	function handleDocClick(e: MouseEvent) {
		if (!open) return;
		if (containerRef && !containerRef.contains(e.target as Node)) open = false;
	}

	$effect(() => {
		if (!open) return;
		document.addEventListener('mousedown', handleDocClick);
		return () => document.removeEventListener('mousedown', handleDocClick);
	});

	const SelectedIcon = $derived(selected?.icon);
</script>

<div bind:this={containerRef} class={cn('relative', className)}>
	<button
		type="button"
		{id}
		{disabled}
		onclick={() => (open = !open)}
		class={cn(
			'bg-background flex h-10 w-full items-center gap-2 rounded-md border px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
			open ? 'border-ring ring-ring/30 ring-2' : 'border-input hover:bg-muted/40'
		)}
	>
		{#if SelectedIcon}
			<SelectedIcon
				class={cn('h-3.5 w-3.5 shrink-0', selected?.iconClass ?? 'text-muted-foreground')}
			/>
		{:else if TriggerIcon}
			<TriggerIcon class="text-muted-foreground h-3.5 w-3.5 shrink-0" />
		{/if}
		<span class={cn('min-w-0 flex-1 truncate', selected ? '' : 'text-muted-foreground')}>
			{selected ? selected.label : placeholder}
		</span>
		<ChevronDown
			class={cn(
				'text-muted-foreground h-3.5 w-3.5 shrink-0 transition-transform',
				open ? 'rotate-180' : ''
			)}
		/>
	</button>

	{#if open}
		<div
			class="border-border bg-popover absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border shadow-md"
		>
			{#if showSearch}
				<div class="border-border relative border-b">
					<Search
						class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
					/>
					<input
						bind:this={inputRef}
						bind:value={query}
						onkeydown={handleKey}
						placeholder={searchPlaceholder}
						class="placeholder:text-muted-foreground h-9 w-full bg-transparent pr-3 pl-9 text-sm outline-none"
					/>
				</div>
			{/if}

			<div class="max-h-60 overflow-y-auto py-1">
				{#if matches.length === 0}
					<p class="text-muted-foreground px-3 py-3 text-center text-xs">
						No matches for "{query}"
					</p>
				{:else}
					{#each matches as item, i (item.id)}
						{@const ItemIcon = item.icon}
						<button
							type="button"
							onclick={() => pick(item)}
							onmouseenter={() => (highlighted = i)}
							class={cn(
								'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
								highlighted === i ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'
							)}
						>
							{#if ItemIcon}
								<ItemIcon
									class={cn('h-3.5 w-3.5 shrink-0', item.iconClass ?? 'text-muted-foreground')}
								/>
							{/if}
							<span class="flex-1 truncate">{item.label}</span>
							{#if item.id === value}
								<Check class="text-primary h-3.5 w-3.5 shrink-0" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
