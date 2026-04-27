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
	class={`flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-background ${className}`}
>
	{#if eyebrow}
		<div class="px-4 pt-5 pb-3">
			<span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
				{eyebrow}
			</span>
		</div>
	{/if}

	{#if header}
		<div class="px-3 pb-3">
			{@render header()}
		</div>
	{/if}

	<nav class="flex-1 space-y-px pb-4 pr-2">
		{#each items as item (item.href)}
			{@const active = isActive(item)}
			{@const Icon = item.icon}
			<a
				href={item.href}
				class={`group relative flex w-full items-center gap-2 py-1.5 pr-2.5 text-left transition-colors ${
					active
						? 'rounded-r-md bg-accent pl-4 text-accent-foreground'
						: 'mx-2 rounded-md pl-2.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
				}`}
			>
				{#if active}
					<span
						class="absolute left-0 top-0 bottom-0 w-0.75 bg-primary"
						aria-hidden="true"
					></span>
				{/if}
				{#if Icon}
					<Icon class="h-3.5 w-3.5 shrink-0 opacity-70" />
				{/if}
				<span class="flex-1 truncate text-sm font-medium">{item.label}</span>
				{#if item.badge !== undefined}
					<span class="shrink-0 font-mono text-[11px] tabular-nums opacity-60">{item.badge}</span>
				{/if}
			</a>
		{/each}
	</nav>

	{#if footer}
		<div class="border-t border-border/60 px-3 py-3">
			{@render footer()}
		</div>
	{/if}
</aside>
