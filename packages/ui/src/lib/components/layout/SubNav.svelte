<script lang="ts">
	import type { Component } from 'svelte';
	import { page } from '$app/state';

	export interface SubNavItem {
		href: string;
		label: string;
		icon?: Component;
		match?: 'exact' | 'prefix';
	}

	interface SubNavProps {
		items: SubNavItem[];
		class?: string;
	}

	let { items, class: className = '' }: SubNavProps = $props();

	function isActive(item: SubNavItem): boolean {
		const path = page.url.pathname;
		if (item.match === 'prefix') return path.startsWith(item.href);
		return path === item.href;
	}
</script>

<nav class={`gap-1 flex items-center ${className}`}>
	{#each items as item (item.href)}
		{@const active = isActive(item)}
		<a
			href={item.href}
			class={[
				'h-7 px-3 gap-1.5 rounded-md flex items-center text-sm font-medium transition-colors',
				active
					? 'bg-accent text-accent-foreground'
					: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
			].join(' ')}
		>
			{#if item.icon}
				{@const Icon = item.icon}
				<Icon class="h-3.5 w-3.5" />
			{/if}
			{item.label}
		</a>
	{/each}
</nav>
