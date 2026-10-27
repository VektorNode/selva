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
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Check from '@lucide/svelte/icons/check';
	import * as DropdownMenu from '#lib/components/primitives/dropdown-menu/index.js';

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

	const activeItem = $derived(items.find(isActive));
</script>

<!-- On a phone a 240px column would leave the page ~150px, so the nav collapses to one switcher
     naming the current section; the header and footer drop out. -->
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

	<div class="py-2 sm:hidden px-(--page-px)">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="min-h-11 gap-3 px-3 text-sm font-medium flex w-full items-center rounded-md border border-border bg-card text-left"
					>
						{#if activeItem?.icon}
							{@const Icon = activeItem.icon}
							<Icon class="size-4 shrink-0 opacity-70" />
						{/if}
						<span class="min-w-0 flex-1 truncate">
							{#if eyebrow}<span class="text-muted-foreground">{eyebrow} /</span>{/if}
							{activeItem?.label ?? ''}
						</span>
						<ChevronsUpDown class="size-4 shrink-0 opacity-60" />
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content sideOffset={4}>
				{#each items as item (item.href)}
					{@const active = isActive(item)}
					{@const Icon = item.icon}
					<DropdownMenu.Item class="min-h-11">
						{#snippet child({ props })}
							<a href={item.href} aria-current={active ? 'page' : undefined} {...props}>
								{#if Icon}<Icon class="size-4 opacity-70" />{/if}
								<span class="flex-1">{item.label}</span>
								{#if item.badge !== undefined}
									<span class="font-mono text-2xs tabular-nums opacity-60">{item.badge}</span>
								{/if}
								{#if active}<Check class="size-4" aria-hidden="true" />{/if}
							</a>
						{/snippet}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

	<nav class="pb-4 pr-2 sm:block hidden flex-1 space-y-px">
		{#each items as item (item.href)}
			{@const active = isActive(item)}
			{@const Icon = item.icon}
			<a
				href={item.href}
				aria-current={active ? 'page' : undefined}
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
