<script lang="ts">
	import type { Component } from 'svelte';
	import { Search, ChevronDown, Check } from '@lucide/svelte';
	import { cn } from '$lib/utils.js';

	export interface FilterableDropdownItem {
		id: string;
		label: string;
		icon?: Component;
		iconClass?: string;
		iconStyle?: string;
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
			'h-10 gap-2 px-3 text-sm flex w-full items-center rounded-md border bg-background text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
			open ? 'border-ring ring-2 ring-ring/30' : 'border-input hover:bg-muted/40'
		)}
	>
		{#if SelectedIcon}
			<SelectedIcon
				class={cn('h-3.5 w-3.5 shrink-0', selected?.iconClass ?? 'text-muted-foreground')}
				style={selected?.iconStyle}
			/>
		{:else if TriggerIcon}
			<TriggerIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
		{/if}
		<span class={cn('min-w-0 flex-1 truncate', selected ? '' : 'text-muted-foreground')}>
			{selected ? selected.label : placeholder}
		</span>
		<ChevronDown
			class={cn(
				'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
				open ? 'rotate-180' : ''
			)}
		/>
	</button>

	{#if open}
		<div
			class="right-0 left-0 mt-1 shadow-md absolute top-full z-50 overflow-hidden rounded-md border border-border bg-popover"
		>
			{#if showSearch}
				<div class="relative border-b border-border">
					<Search
						class="left-3 h-3.5 w-3.5 pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
					<input
						bind:this={inputRef}
						bind:value={query}
						onkeydown={handleKey}
						placeholder={searchPlaceholder}
						class="h-8 pr-3 pl-9 text-sm w-full bg-transparent outline-none placeholder:text-muted-foreground"
					/>
				</div>
			{/if}

			<div class="max-h-60 overflow-y-auto">
				{#if matches.length === 0}
					<p class="px-3 py-3 text-xs text-center text-muted-foreground">
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
								'gap-2 px-3 py-1.5 text-sm flex w-full items-center text-left transition-colors',
								highlighted === i ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'
							)}
						>
							{#if ItemIcon}
								<ItemIcon
									class={cn('h-3.5 w-3.5 shrink-0', item.iconClass ?? 'text-muted-foreground')}
									style={item.iconStyle}
								/>
							{/if}
							<span class="flex-1 truncate">{item.label}</span>
							{#if item.id === value}
								<Check class="h-3.5 w-3.5 shrink-0 text-primary" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
