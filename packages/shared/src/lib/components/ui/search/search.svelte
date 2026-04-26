<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { Search as SearchIcon, X as XIcon } from '@lucide/svelte';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import Input from '../input/input.svelte';

	type Props = WithElementRef<
		HTMLInputAttributes & {
			clearable?: boolean;
			badge?: string | number;
			badgeClass?: string;
			containerClass?: string;
			children?: Snippet;
		}
	>;

	let {
		ref = $bindable(null),
		value = $bindable(''),
		clearable = false,
		badge,
		badgeClass,
		containerClass,
		placeholder = 'Search...',
		class: className,
		children,
		...restProps
	}: Props = $props();

	const handleClear = () => {
		value = '';
		ref?.focus();
	};
</script>

<div class={cn('relative w-full', containerClass)}>
	<SearchIcon
		class="left-3 h-3.5 w-3.5 pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground"
	/>
	<Input
		bind:this={ref}
		bind:value
		{placeholder}
		class={cn('pl-9 pr-12', className)}
		{...restProps}
	/>
	{#if clearable && value}
		<button
			type="button"
			onclick={handleClear}
			class="right-3 absolute top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
			aria-label="Clear search"
		>
			<XIcon class="h-4 w-4" />
		</button>
	{:else if badge !== undefined}
		<span
			class={cn(
				'right-3 font-mono absolute top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground',
				badgeClass
			)}
		>
			{badge}
		</span>
	{:else if children}
		<div class="right-3 pointer-events-none absolute top-1/2 -translate-y-1/2">
			{@render children()}
		</div>
	{/if}
</div>
