<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface SideNavItem {
		href: string;
		label: string;
		icon?: Component;
		match?: 'exact' | 'prefix';
		badge?: string | number;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	interface SideNavProps {
		items: SideNavItem[];
		eyebrow?: string;
		header?: Snippet;
		footer?: Snippet;
		/**
		 * Off when the divider is drawn by the surrounding layout instead — a sticky sidenav
		 * only reaches as far as its own content, so its border would stop mid-page.
		 */
		border?: boolean;
		class?: string;
	}

	let {
		items,
		eyebrow,
		header,
		footer,
		border = true,
		class: className = ''
	}: SideNavProps = $props();

	function isActive(item: SideNavItem): boolean {
		const path = page.url.pathname;
		if (item.match === 'prefix') return path.startsWith(item.href);
		return path === item.href;
	}
</script>

<!-- On a phone a 240px column would leave the page ~150px, so the nav becomes a scrolling strip
     above the content and the eyebrow, header and footer drop out. -->
<aside
	class={`sm:h-full sm:w-60 sm:overflow-y-auto sm:border-b-0 flex w-full shrink-0 flex-col border-b border-border bg-background ${
		border ? 'sm:border-r' : ''
	} ${className}`}
>
	{#if eyebrow}
		<div class="px-4 pt-5 pb-3 sm:block hidden">
			<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
				{eyebrow}
			</span>
		</div>
	{/if}

	{#if header}
		<div class="px-3 pb-3 sm:block hidden">
			{@render header()}
		</div>
	{/if}

	<nav
		class="gap-1 py-2 sm:gap-0 sm:pt-0 sm:pb-4 sm:pr-2 sm:flex-1 sm:space-y-px sm:block sm:px-0 flex overflow-x-auto px-(--page-px)"
	>
		{#each items as item (item.href)}
			{@const active = isActive(item)}
			{@const Icon = item.icon}
			<a
				href={item.href}
				class={`group gap-2 py-2 pr-2.5 sm:py-1.5 sm:w-full relative flex shrink-0 items-center text-left transition-colors ${
					active
						? 'pl-2.5 sm:pl-4 sm:rounded-l-none sm:rounded-r-md rounded-md bg-accent text-accent-foreground'
						: 'sm:mx-2 pl-2.5 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground'
				}`}
			>
				{#if active}
					<span
						class="left-0 top-0 bottom-0 w-0.75 sm:block absolute hidden bg-primary"
						aria-hidden="true"
					></span>
				{/if}
				{#if Icon}
					<Icon class="h-3.5 w-3.5 shrink-0 opacity-70" />
				{/if}
				<span class="text-sm font-medium sm:flex-1 sm:truncate whitespace-nowrap">{item.label}</span
				>
				{#if item.badge !== undefined}
					<span class="font-mono shrink-0 text-2xs tabular-nums opacity-60">{item.badge}</span>
				{/if}
			</a>
		{/each}
	</nav>

	{#if footer}
		<div class="px-3 py-3 sm:block hidden border-t border-border/60">
			{@render footer()}
		</div>
	{/if}
</aside>
