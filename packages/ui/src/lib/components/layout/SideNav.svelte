<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { page } from '$app/state';

	export interface SideNavItem {
		href: string;
		label: string;
		icon?: Component;
		match?: 'exact' | 'prefix';
		badge?: string | number;
	}

	interface SideNavProps {
		items: SideNavItem[];
		eyebrow?: string;
		header?: Snippet;
		footer?: Snippet;
		class?: string;
	}

	let { items, eyebrow, header, footer, class: className = '' }: SideNavProps = $props();

	function isActive(item: SideNavItem): boolean {
		const path = page.url.pathname;
		if (item.match === 'prefix') return path.startsWith(item.href);
		return path === item.href;
	}
</script>

<aside
	class={`w-60 flex shrink-0 flex-col overflow-y-auto border-r border-border bg-background ${className}`}
>
	{#if eyebrow}
		<div class="px-4 pt-5 pb-3">
			<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
				{eyebrow}
			</span>
		</div>
	{/if}

	{#if header}
		<div class="px-3 pb-3">
			{@render header()}
		</div>
	{/if}

	<nav class="pb-4 pr-2 flex-1 space-y-px">
		{#each items as item (item.href)}
			{@const active = isActive(item)}
			{@const Icon = item.icon}
			<a
				href={item.href}
				class={`group gap-2 py-1.5 pr-2.5 relative flex w-full items-center text-left transition-colors ${
					active
						? 'pl-4 rounded-r-md bg-accent text-accent-foreground'
						: 'mx-2 pl-2.5 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground'
				}`}
			>
				{#if active}
					<span class="left-0 top-0 bottom-0 w-0.75 absolute bg-primary" aria-hidden="true"></span>
				{/if}
				{#if Icon}
					<Icon class="h-3.5 w-3.5 shrink-0 opacity-70" />
				{/if}
				<span class="text-sm font-medium flex-1 truncate">{item.label}</span>
				{#if item.badge !== undefined}
					<span class="font-mono shrink-0 text-[11px] tabular-nums opacity-60">{item.badge}</span>
				{/if}
			</a>
		{/each}
	</nav>

	{#if footer}
		<div class="px-3 py-3 border-t border-border/60">
			{@render footer()}
		</div>
	{/if}
</aside>
