<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { Search as SearchIcon, X as XIcon } from '@lucide/svelte';
	import { cn, type WithElementRef } from '$lib/utils.js';

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, 'type'> & {
			clearable?: boolean;
			badge?: string | number;
			badgeClass?: string;
			containerClass?: string;
			children?: Snippet;
		},
		HTMLInputElement
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
	<input
		bind:this={ref}
		bind:value
		type="search"
		{placeholder}
		data-slot="input"
		class={cn(
			'h-9 min-w-0 px-3 py-1 text-base shadow-xs md:text-sm flex w-full rounded-md border border-input bg-background ring-offset-background transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
			'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
			'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
			'pl-9 pr-12',
			className
		)}
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
