<script lang="ts">
	import { page } from '$app/state';
	import { LayoutGrid, GitBranch } from '@lucide/svelte';
	import type { Component } from 'svelte';

	const hasOrg = $derived(!!(page.data as { ctx?: { orgId?: string } }).ctx?.orgId);

	const items = $derived(
		[
			{
				href: '/library',
				label: 'Library',
				icon: LayoutGrid as Component,
				match: 'prefix',
				show: true
			},
			{
				href: '/projects',
				label: 'Projects',
				icon: GitBranch as Component,
				match: 'prefix',
				show: hasOrg
			}
		].filter((i) => i.show)
	);

	function isActive(item: (typeof items)[number]): boolean {
		const path = page.url.pathname;
		if (item.match === 'prefix') return path.startsWith(item.href);
		return path === item.href;
	}
</script>

{#each items as item (item.href)}
	{@const active = isActive(item)}
	{@const Icon = item.icon}
	<a
		href={item.href}
		class={[
			'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors',
			active
				? 'bg-accent text-accent-foreground'
				: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
		].join(' ')}
	>
		<Icon class="h-3.5 w-3.5" />
		{item.label}
	</a>
{/each}
